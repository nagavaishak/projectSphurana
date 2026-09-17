import { createFileRoute, redirect } from '@tanstack/react-router';

/**
 * `/billing` — now a redirect, not a page.
 *
 * It used to be the self-serve plan picker: three tiers, a currency guess and
 * a Stripe Checkout button. Nobody arrives at it that way any more. Every
 * subscription comes from a sales call and is attached by an onboarding
 * specialist, or pasted on Settings → Billing, so a "choose your plan" screen
 * asks a customer to buy something they already own.
 *
 * The old page redirected SUBSCRIBED users to the dashboard and showed the
 * pricing table to everyone else — which meant the only people who ever saw it
 * were customers mid-onboarding whose subscription staff had not attached yet.
 * That is precisely the group it was most wrong for, and it landed on them at
 * the moment they had just been told they were finished.
 *
 * The pricing UI is deleted rather than parked behind this redirect: an
 * unreachable checkout that still looks live is the kind of thing that gets
 * "fixed" back into the flow by someone who does not know why it went. It is
 * in git history if a self-serve tier ever returns, and
 * `POST billing/subscription/checkout` still exists to serve one.
 */
export const Route = createFileRoute('/_authed/billing')({
  beforeLoad: () => {
    throw redirect({ to: '/dashboard/settings/billing' });
  },
});
