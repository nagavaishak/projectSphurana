'use client';

import * as React from 'react';

import { Button } from '@/components/ui/button';

import {
  PortalProvider,
  usePortalLink,
  usePortalNavigate,
} from '../api/portal-provider';
import { useVerifyMagicLink } from '../api/verify-magic-link.hook';
import { PortalAuthLayout } from '../portal-auth-layout';
import type { PortalContext } from '../portal-context';
import { Spinner } from '../ui/spinner';

/**
 * Magic-link landing (staff "Copy portal link" flow): verifies the single-use
 * token immediately and drops the customer on the portal home. A dead link is
 * never a dead end — it always offers the OTP sign-in instead.
 *
 * The token arrives as `?token=` and is read SERVER-side in the Astro page,
 * then passed in. TanStack's `validateSearch` did the same job; the point is
 * unchanged — the component never parses the URL itself.
 */
function AccessFlow({
  organizationSlug,
  token,
}: {
  organizationSlug: string;
  token: string | null;
}) {
  const navigate = usePortalNavigate();
  const link = usePortalLink();

  // Failure is held in LOCAL state, not read from `mutation.error`: a mutation
  // fired from a ref-guarded mount effect loses its observer subscription under
  // React StrictMode's simulated remount, so `mutation.error` never triggers a
  // re-render and a dead link hangs on the spinner forever. The option
  // callbacks still fire — use those.
  const [verifyFailed, setVerifyFailed] = React.useState(false);

  const { verifyMagicLink } = useVerifyMagicLink({
    onSuccess: () => navigate('', { replace: true }),
    onError: () => setVerifyFailed(true),
  });

  // Fire exactly once — the token is single-use, so a StrictMode double
  // effect would consume it on the first call and fail the second.
  const firedRef = React.useRef(false);
  React.useEffect(() => {
    if (!token || firedRef.current) return;
    firedRef.current = true;
    verifyMagicLink({ token, organizationSlug });
  }, [token, organizationSlug, verifyMagicLink]);

  const failed = !token || verifyFailed;

  if (failed) {
    return (
      <div
        className="flex flex-col items-center gap-4 py-4 text-center animate-in fade-in duration-300 motion-reduce:animate-none"
        role="alert"
      >
        <h1 className="text-xl font-bold">Link expired</h1>
        <p className="text-muted-foreground text-sm text-balance">
          This link has expired or was already used.
        </p>
        <Button asChild>
          <a href={link('/sign-in')}>Sign in with email instead</a>
        </Button>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col items-center gap-4 py-10 text-center"
      aria-live="polite"
    >
      <Spinner className="size-6" />
      <p className="text-muted-foreground text-sm">Signing you in…</p>
    </div>
  );
}

export function PortalAccessIsland({
  ctx,
  token,
}: {
  ctx: PortalContext;
  token: string | null;
}) {
  return (
    <PortalProvider ctx={ctx}>
      <PortalAuthLayout>
        <AccessFlow organizationSlug={ctx.organizationSlug} token={token} />
      </PortalAuthLayout>
    </PortalProvider>
  );
}
