import { subscriptionStatusLabels } from '@borradh-workspace/api-client/types';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';

import { PageShell } from '@/components/app/page-shell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCreatePortalSession,
  useGetSubscription,
  useSeedSubscription,
} from '@/features/billing';
import { ROUTES } from '@/lib/route-paths';
import { webAppUrl } from '@/lib/web-app-origin';

export const Route = createFileRoute('/_authed/dashboard/settings/billing')({
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  const { subscription, isLoading } = useGetSubscription();

  const statusLabel = subscription
    ? (subscriptionStatusLabels[subscription.status] ?? subscription.status)
    : null;
  const isActive =
    subscription?.status === 'active' || subscription?.status === 'trialing';

  return (
    <PageShell className="pt-10 pb-8" maxWidth="max-w-[960px]">
      <title>Billing | Borradh</title>

      {isLoading ? (
        <Skeleton className="h-44 w-full rounded-xl" />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Subscription
              {statusLabel ? (
                <Badge variant={isActive ? 'default' : 'secondary'}>
                  {statusLabel}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription>
              {subscription
                ? 'Your plan and billing are managed through our checkout.'
                : 'You don’t have an active subscription yet.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {subscription ? <ManagePlanButton /> : null}

            {!isActive && <SeedSubscription />}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}

/**
 * Send a subscribed merchant to the Stripe customer portal.
 *
 * This used to be `<Link to="/billing">`, which was correct while `/billing`
 * was the self-serve plan picker. That route is now a redirect BACK to this
 * page, so the button navigated to itself: clicking it left the URL unchanged
 * and nothing happened. The unsubscribed variant read "Choose a plan" and
 * promised a picker that no longer exists at all.
 *
 * `billing.spec.ts` could not catch it — it asserts the redirect destination
 * and the absence of a "Choose your plan" HEADING, and a self-referential link
 * satisfies both.
 *
 * There is no plan picker to send anyone to any more, so the only destination
 * that means anything is Stripe's own portal, where a subscription can actually
 * be changed or its card updated. Rendered only when a subscription exists:
 * with none, there is nothing to manage and `SeedSubscription` below is the
 * real path.
 */
function ManagePlanButton() {
  // webAppUrl, NOT window.location.href — inside the Capacitor WebView the
  // document origin is `capacitor://localhost`, which passes `externalRedirectUrl`'s
  // `z.string().url()` and is then rejected by Stripe as "Not a valid URL".
  // See apps/app/src/lib/web-app-origin.ts.
  const { openPortal, isOpening } = useCreatePortalSession();

  return (
    <Button
      onClick={() =>
        openPortal({ returnUrl: webAppUrl(ROUTES.settingsBilling) })
      }
      disabled={isOpening}
    >
      {isOpening ? 'Opening…' : 'Manage plan'}
    </Button>
  );
}

/**
 * Attach a subscription that was bought on a sales call.
 *
 * Customers on that path pay in Stripe during the call, so there is no
 * checkout to run and this workspace would otherwise sit unsubscribed — no
 * plan, no credits — until someone put them through a payment they had already
 * made. Shown only while there is no live subscription: with one in place it is
 * an invitation to break something that works.
 */
function SeedSubscription() {
  const [stripeRef, setStripeRef] = useState('');
  // Deliberately does NOT clear on success: the id stays visible as the record
  // of what was attached, and on a refusal it is still there to check against
  // Stripe rather than gone.
  const { seedSubscription, isSeeding } = useSeedSubscription();

  const trimmed = stripeRef.trim();
  const looksValid = /^(sub|cus)_[A-Za-z0-9]+$/.test(trimmed);

  return (
    <form
      className="border-t pt-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!looksValid || isSeeding) return;
        seedSubscription(trimmed);
      }}
    >
      <Field>
        <FieldLabel htmlFor="stripe-subscription-ref">
          Already paid? Enter your Stripe subscription ID
        </FieldLabel>
        <FieldDescription>
          If you set your plan up with our team, paste the <code>sub_…</code> or{' '}
          <code>cus_…</code> from Stripe and we&rsquo;ll attach it — no second
          payment.
        </FieldDescription>
        <div className="flex gap-2">
          <Input
            id="stripe-subscription-ref"
            value={stripeRef}
            onChange={(e) => setStripeRef(e.target.value)}
            placeholder="sub_1A2b3C4d5E6f"
            autoComplete="off"
            spellCheck={false}
            disabled={isSeeding}
          />
          <Button type="submit" disabled={!looksValid || isSeeding}>
            {isSeeding ? 'Attaching…' : 'Attach'}
          </Button>
        </div>
      </Field>
    </form>
  );
}
