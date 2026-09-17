import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useInitiateMetaAdsFlfb } from '../api/initiate-meta-ads-flfb';
import { useFacebookSdk } from './use-facebook-sdk';

interface UseMetaLoginForBusinessOptions {
  onSuccess?: (data: { integrationId: string }) => void;
  onError?: (error: Error) => void;
}

/**
 * Opens Meta's Facebook Login for Business popup — one config covering
 * Facebook Pages, ad accounts, and Instagram — and starts the Meta Ads
 * integration server-side when the user completes it. This is the FLFB
 * replacement for the classic redirect OAuth (useInitiateMetaAdsAuth).
 *
 * Flow:
 *   1. FB SDK loads + initializes in the background (useFacebookSdk).
 *   2. launch() calls FB.login with the FLFB `config_id`. The flow is
 *      redirect-less — the code is returned in-page via the SDK callback,
 *      so there is no postMessage/waba step like WhatsApp has.
 *   3. On success, POSTs { code } to /integrations/meta-ads/initiate, which
 *      exchanges it for a non-expiring system-user token and saves a
 *      pending_selection integration. onSuccess fires with the integrationId
 *      so the caller can navigate to the selection wizard (/connect/meta-ads).
 *
 * launch() must be called synchronously from a user gesture — do not await
 * anything before calling it or popup blockers will kill the window.
 */
export const useMetaLoginForBusiness = (
  options?: UseMetaLoginForBusinessOptions
) => {
  const { fb, isReady } = useFacebookSdk();
  const [isLaunching, setIsLaunching] = useState(false);
  const { metaLoginConfigId: configId } = useRuntimeConfig();

  const { initiateAsync, isInitiating } = useInitiateMetaAdsFlfb({
    onSuccess: (data) => {
      setIsLaunching(false);
      options?.onSuccess?.(data);
    },
    onError: (err) => {
      setIsLaunching(false);
      options?.onError?.(err);
    },
  });

  const launch = useCallback(() => {
    if (!fb) {
      toast.error('Facebook is still loading — try again in a moment');
      return;
    }
    if (!configId) {
      toast.error('Facebook Login for Business is not configured');
      return;
    }

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
        initiateAsync({ code }).catch(() => {
          /* surfaced via the mutation's onError toast */
        });
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
      }
    );
  }, [fb, configId, initiateAsync]);

  return {
    launch,
    isReady,
    isBusy: isLaunching || isInitiating,
  };
};
