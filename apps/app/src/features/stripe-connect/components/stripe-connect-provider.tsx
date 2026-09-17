import { loadConnectWithCapture } from '@/lib/stripe-loader';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import type { StripeConnectInstance } from '@stripe/connect-js';
import { ConnectComponentsProvider } from '@stripe/react-connect-js';
import { type ReactNode, useState } from 'react';
import { useCreateAccountSession } from '../api';

interface StripeConnectProviderProps {
  children: ReactNode;
  /** Rendered when Stripe cannot be initialised (no publishable key). */
  fallback?: ReactNode;
}

/**
 * Boots the embedded Stripe Connect JS instance and provides it to the
 * `@stripe/react-connect-js` component tree. The client secret is minted (and
 * the controller account lazily created) by POST /integrations/stripe/account-session.
 */
export function StripeConnectProvider({
  children,
  fallback = null,
}: StripeConnectProviderProps) {
  const { stripePublishableKey } = useRuntimeConfig();
  const { createAccountSessionAsync } = useCreateAccountSession();

  const [instance] = useState<StripeConnectInstance | null>(() => {
    if (!stripePublishableKey) return null;
    return loadConnectWithCapture({
      publishableKey: stripePublishableKey,
      fetchClientSecret: async () => {
        const res = await createAccountSessionAsync({});
        return res.clientSecret;
      },
    });
  });

  if (!instance) return <>{fallback}</>;

  return (
    <ConnectComponentsProvider connectInstance={instance}>
      {children}
    </ConnectComponentsProvider>
  );
}
