import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useFinalizeWhatsAppConnection } from '../api/finalize-whatsapp-connection';
import { useFacebookSdk } from './use-facebook-sdk';

type WaEmbeddedSignupMessage = {
  type: 'WA_EMBEDDED_SIGNUP';
  event?: string;
  data?: { waba_id?: string; phone_number_id?: string };
  version?: number;
};

interface UseWhatsAppEmbeddedSignupOptions {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

/**
 * Opens Meta's WhatsApp Embedded Signup popup in Coexistence mode and
 * finalizes the connection server-side when the customer completes it.
 *
 * Flow:
 *   1. FB SDK is loaded + initialized in the background.
 *   2. A postMessage listener captures `waba_id` from Meta's popup.
 *   3. `launch()` calls `FB.login` with the Coexistence extras.
 *   4. On success, POSTs `{ code, wabaId }` to `/integrations/whatsapp/finalize`.
 *
 * Important: `launch()` must be called synchronously from a user gesture —
 * do not await anything before calling it or popup blockers will kill the
 * window.
 */
export const useWhatsAppEmbeddedSignup = (
  options?: UseWhatsAppEmbeddedSignupOptions
) => {
  const { fb, isReady } = useFacebookSdk();
  const [isLaunching, setIsLaunching] = useState(false);
  const wabaIdRef = useRef<string | null>(null);
  const { whatsappEmbeddedSignupConfigId: configId } = useRuntimeConfig();

  const { finalizeAsync, isFinalizing } = useFinalizeWhatsAppConnection({
    onSuccess: () => {
      setIsLaunching(false);
      options?.onSuccess?.();
    },
    onError: (err) => {
      setIsLaunching(false);
      options?.onError?.(err);
    },
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      // Strict origin check — `endsWith('facebook.com')` would also match
      // `https://evilfacebook.com`. Require the exact host or a dotted suffix.
      let host: string;
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return;
      try {
        const data =
          typeof event.data === 'string'
            ? (JSON.parse(event.data) as WaEmbeddedSignupMessage)
            : (event.data as WaEmbeddedSignupMessage);
        if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;
        if (data.data?.waba_id) {
          wabaIdRef.current = data.data.waba_id;
        }
      } catch {
        /* ignore non-JSON messages */
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const launch = useCallback(() => {
    if (!fb) {
      toast.error('Facebook is still loading — try again in a moment');
      return;
    }
    if (!configId) {
      toast.error('WhatsApp Embedded Signup is not configured');
      return;
    }

    wabaIdRef.current = null;
    setIsLaunching(true);

    // FB SDK rejects AsyncFunction callbacks — keep this sync and let the
    // mutation run detached. onSuccess / onError are wired on the mutation.
    fb.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (!code) {
          setIsLaunching(false);
          return;
        }
        const wabaId = wabaIdRef.current;
        if (!wabaId) {
          setIsLaunching(false);
          toast.error(
            'WhatsApp Business Account was not returned from Meta — please try again'
          );
          return;
        }
        finalizeAsync({ code, wabaId }).catch(() => {
          /* surfaced via the mutation's onError toast */
        });
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: 'whatsapp_business_app_onboarding',
          sessionInfoVersion: '3',
        },
      }
    );
  }, [fb, configId, finalizeAsync]);

  return {
    launch,
    isReady,
    isBusy: isLaunching || isFinalizing,
  };
};
