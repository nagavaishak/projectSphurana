import type * as React from 'react';

import { Logo } from '@/components/global/logo';

/**
 * Auth-page chrome: logo top-left, centered card. Used by sign-in, sign-up,
 * forgot-password, reset-password, verify-email, verify-2fa.
 */
export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col p-6 md:p-10">
      <div className="flex justify-center gap-2 md:justify-start">
        <Logo />
      </div>
      <div className="flex flex-1 items-center justify-center">
        <div className="w-full max-w-xs">{children}</div>
      </div>
    </div>
  );
}
