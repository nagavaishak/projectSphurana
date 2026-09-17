import { createFileRoute } from '@tanstack/react-router';
import { CheckCircle2Icon, InfoIcon, XCircleIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';

type SelfServeStatus = 'connected' | 'cancelled' | 'error';

/**
 * Where the shareable Stripe onboarding link lands the merchant.
 *
 * PUBLIC on purpose. The whole value of that link is that it can be sent
 * straight after a sales call, before this person has a Borradh login — so
 * this page cannot sit behind the authed shell, and it must make sense to
 * someone who has never seen the product.
 */
export const Route = createFileRoute('/connect/stripe/done')({
  validateSearch: (
    search: Record<string, unknown>
  ): { status?: SelfServeStatus; account?: string } => ({
    status:
      search.status === 'connected' ||
      search.status === 'cancelled' ||
      search.status === 'error'
        ? search.status
        : undefined,
    account: typeof search.account === 'string' ? search.account : undefined,
  }),
  component: StripeSelfServeDonePage,
});

function StripeSelfServeDonePage() {
  const { status, account } = Route.useSearch();

  return (
    <>
      <title>Stripe setup | Borradh</title>
      <div className="mx-auto flex min-h-svh max-w-lg items-center px-4">
        <Card className="w-full">
          <CardContent className="space-y-4 pt-6">
            {status === 'connected' ? (
              <>
                <div className="flex items-center gap-2">
                  <CheckCircle2Icon className="text-primary size-5" />
                  <h1 className="text-lg font-semibold">
                    Your Stripe account is connected
                  </h1>
                </div>
                <p className="text-muted-foreground text-sm">
                  Nothing else to do here. We&rsquo;ll finish setting up
                  payments on your account — you don&rsquo;t need to keep this
                  page open.
                </p>
                {account && (
                  <div className="space-y-1 rounded-lg border p-3">
                    <p className="text-xs uppercase text-muted-foreground">
                      Your Stripe account ID
                    </p>
                    {/* Shown so they can quote it if asked. It is an
                        identifier, not a credential — it grants nothing on its
                        own. */}
                    <p className="font-mono text-sm">{account}</p>
                    <p className="text-muted-foreground text-xs">
                      Only needed if your onboarding contact asks for it.
                    </p>
                  </div>
                )}
              </>
            ) : status === 'cancelled' ? (
              <>
                <div className="flex items-center gap-2">
                  <InfoIcon className="text-muted-foreground size-5" />
                  <h1 className="text-lg font-semibold">Setup not finished</h1>
                </div>
                <p className="text-muted-foreground text-sm">
                  You left Stripe before finishing. Open the link we sent you
                  again whenever you&rsquo;re ready — nothing was lost.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <XCircleIcon className="text-destructive size-5" />
                  <h1 className="text-lg font-semibold">
                    We couldn&rsquo;t finish connecting
                  </h1>
                </div>
                <p className="text-muted-foreground text-sm">
                  Something went wrong on our side. Try the link again, and if
                  it still fails, tell your onboarding contact — they can see
                  what happened.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
