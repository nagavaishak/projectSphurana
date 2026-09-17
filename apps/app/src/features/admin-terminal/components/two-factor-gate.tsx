import { apiClient } from '@borradh-workspace/api-client';
import { useCallback, useEffect, useState } from 'react';

import { useSession } from '@/lib/session';

import { TwoFactorSetup } from './two-factor-setup';
import { TwoFactorVerify } from './two-factor-verify';

interface TwoFactorGateProps {
  children: React.ReactNode;
}

type GateState = 'loading' | 'setup-2fa' | 'verify-2fa' | 'verified';

export function TwoFactorGate({ children }: TwoFactorGateProps) {
  const { data } = useSession();
  const user = data?.user ?? null;
  const [gateState, setGateState] = useState<GateState>('loading');

  const probe2faStatus = useCallback(async () => {
    try {
      await apiClient.get('admin-terminal/organizations?limit=1');
      setGateState('verified');
    } catch {
      // Any error here (401 ADMIN_2FA_REQUIRED, 403, network) → show verify.
      // The API enforces the actual check; this is just the prompt UX.
      setGateState('verify-2fa');
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    if (!user.twoFactorEnabled) {
      setGateState('setup-2fa');
      return;
    }

    probe2faStatus();
  }, [user, probe2faStatus]);

  if (gateState === 'loading') {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    );
  }

  if (gateState === 'setup-2fa') {
    return (
      <TwoFactorSetup onSetupComplete={() => setGateState('verify-2fa')} />
    );
  }

  if (gateState === 'verify-2fa') {
    return <TwoFactorVerify onVerified={() => setGateState('verified')} />;
  }

  return <>{children}</>;
}
