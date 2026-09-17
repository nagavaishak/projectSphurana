import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
// Narrow import (not the '@/features/integrations/api' barrel): the barrel
// transitively pulls the route tree, which breaks suites that partially mock
// @tanstack/react-router (e.g. create-account-link.contract.test).
import { useDisconnectStripe } from '@/features/integrations/api/disconnect-stripe';
import { ROUTES } from '@/lib/route-paths';
import { webAppUrl } from '@/lib/web-app-origin';
import type { StripeConnectStatus } from '@borradh-workspace/api-client/types';
import {
  ConnectBalances,
  ConnectPayouts,
  ConnectTaxRegistrations,
  ConnectTaxSettings,
} from '@stripe/react-connect-js';
import { Link } from '@tanstack/react-router';
import { CheckCircle2Icon, ExternalLinkIcon, UnplugIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  useCreateAccountLink,
  useGetAccountStatus,
  useLinkStripeAccount,
  useRefreshAccountStatus,
} from '../api';
import { StripeConnectProvider } from './stripe-connect-provider';

/**
 * Settings surface for Stripe payments. Controller accounts onboard through
 * Stripe-hosted onboarding (a redirect to Stripe, not an embedded iframe);
 * legacy OAuth-connected standard accounts keep pointing at the existing
 * integrations flow (contract §7.A).
 *
 * In preview, the connected org is seeded with a real Connect account (see
 * setup-connected → seedConnectedStripeConnect), so this panel renders the
 * Active state instead of the onboarding button that 500s under the stub.
 */
export function StripeConnectPanel() {
  const { status, isLoading } = useGetAccountStatus();
  const { createAccountLinkAsync, isCreating } = useCreateAccountLink();
  const { refreshAccountStatus } = useRefreshAccountStatus();

  // When the user returns from Stripe-hosted onboarding, pull the latest state
  // live from Stripe (the account.updated webhook may not have arrived yet),
  // then strip the marker query param so a refresh doesn't re-trigger it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'return') {
      refreshAccountStatus();
      params.delete('stripe');
      const search = params.toString();
      window.history.replaceState(
        {},
        '',
        `${window.location.pathname}${search ? `?${search}` : ''}`
      );
    }
  }, [refreshAccountStatus]);

  const startOnboarding = async () => {
    try {
      const base = webAppUrl(ROUTES.settingsPayments);
      const { url } = await createAccountLinkAsync({ baseUrl: base });
      window.location.href = url;
    } catch {
      toast.error('Could not start Stripe onboarding. Please try again.');
    }
  };

  if (isLoading) {
    return <Skeleton className="h-40 w-full" />;
  }

  // ONLY the legacy in-product OAuth integration, which is managed from the
  // Integrations screen. A Standard account onboarded from a self-serve link
  // and attached by an operator is 'standard_linked' and belongs in the normal
  // status view — it is the current path, not a leftover.
  const isLegacyOauth = status?.accountType === 'standard_oauth';
  const detailsSubmitted = status?.detailsSubmitted ?? false;
  const chargesEnabled = status?.chargesEnabled ?? false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Payments
          {chargesEnabled && (
            <Badge className="gap-1">
              <CheckCircle2Icon className="size-3" /> Active
            </Badge>
          )}
        </CardTitle>
        <CardDescription>
          Accept in-person and online payments through Stripe.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLegacyOauth ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              This workspace is connected to Stripe via the legacy integration.
            </p>
            <Button asChild variant="outline">
              <Link to={ROUTES.integrations}>
                Manage in Integrations
                <ExternalLinkIcon className="size-4" />
              </Link>
            </Button>
          </div>
        ) : detailsSubmitted ? (
          <>
            <div className="flex flex-wrap gap-2 text-sm">
              <StatusPill ok={chargesEnabled} label="Charges" />
              <StatusPill
                ok={status?.payoutsEnabled ?? false}
                label="Payouts"
              />
            </div>

            {(() => {
              const message = paymentsStatusMessage(status);
              if (!message) return null;
              return <p className="text-sm text-muted-foreground">{message}</p>;
            })()}

            {status?.requirementsCurrentlyDue &&
              status.requirementsCurrentlyDue.length > 0 && (
                <Button onClick={startOnboarding} disabled={isCreating}>
                  {isCreating ? 'Redirecting…' : 'Complete required details'}
                </Button>
              )}

            <StripeConnectProvider
              fallback={
                <p className="text-sm text-muted-foreground">
                  Payouts unavailable in this environment.
                </p>
              }
            >
              <div className="space-y-6">
                <ConnectBalances />
                <ConnectPayouts />
                <section className="space-y-4 border-t pt-6">
                  <div>
                    <h3 className="font-medium">Tax setup</h3>
                    <p className="text-sm text-muted-foreground">
                      Set your head office, default product classification and
                      tax registrations. Stripe uses these to calculate tax on
                      your sales.
                    </p>
                  </div>
                  <ConnectTaxSettings />
                  <ConnectTaxRegistrations />
                </section>
              </div>
            </StripeConnectProvider>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Finish setting up payments to start taking sales.
            </p>
            <Button onClick={startOnboarding} disabled={isCreating}>
              {isCreating ? 'Redirecting…' : 'Set up payments'}
            </Button>
            {/* Only when nothing is connected yet: with a row already in
                place the server refuses a repoint (and says so), and
                "Disconnect Stripe" below is the honest way through. */}
            {!status?.connected && <LinkExistingAccount />}
          </div>
        )}

        {/* Disconnect is available for any real connection (finished or not).
            Legacy OAuth accounts manage disconnection from the Integrations
            page, so they're excluded here. */}
        {status?.connected && !isLegacyOauth && <DisconnectPaymentsButton />}
      </CardContent>
    </Card>
  );
}

/**
 * Link an account the merchant has ALREADY onboarded with Stripe, by pasting
 * its `acct_` id.
 *
 * Some merchants finish Stripe onboarding from a link sent right after the
 * sales call, before this workspace exists. By the time they get here the
 * account is live, so "Set up payments" has nothing left to collect and the
 * id is the only handle onto it. Collapsed by default — for everyone else the
 * button above is the path.
 */
function LinkExistingAccount() {
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState('');
  // The id is not cleared on success — it is the record of what was linked,
  // and on a refusal it stays in front of the operator instead of sending them
  // back to Stripe for it.
  const { linkStripeAccount, isLinking } = useLinkStripeAccount({
    onSuccess: () => setOpen(false),
  });

  const trimmed = accountId.trim();
  const looksValid = /^acct_[A-Za-z0-9]+$/.test(trimmed);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="px-0">
          Already set up with Stripe? Link an existing account
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <form
          className="pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!looksValid || isLinking) return;
            linkStripeAccount({ stripeAccountId: trimmed });
          }}
        >
          <Field>
            <FieldLabel htmlFor="stripe-account-id">
              Stripe account ID
            </FieldLabel>
            <FieldDescription>
              Find it in the Stripe dashboard under Connect → Accounts. It
              starts with <code>acct_</code>.
            </FieldDescription>
            <div className="flex gap-2">
              <Input
                id="stripe-account-id"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                placeholder="acct_1A2b3C4d5E6f7G8h"
                autoComplete="off"
                spellCheck={false}
                disabled={isLinking}
              />
              <Button type="submit" disabled={!looksValid || isLinking}>
                {isLinking ? 'Connecting…' : 'Connect'}
              </Button>
            </div>
          </Field>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Destructive "Disconnect Stripe" control with a confirmation step. Removes the
 * integration row (DELETE integrations/stripe/integration) and invalidates the
 * account-status query, so the panel falls back to the "Set up payments" state.
 */
function DisconnectPaymentsButton() {
  const [open, setOpen] = useState(false);
  const { disconnectStripe, isDisconnecting } = useDisconnectStripe({
    onSuccess: () => setOpen(false),
  });

  return (
    <div className="border-t pt-4">
      <ConfirmDeleteDialog
        confirmLabel="Disconnect"
        description="This removes the Stripe connection from this workspace. You won’t be able to take card or online payments until you reconnect. Payouts already processed by Stripe are unaffected."
        icon={UnplugIcon}
        isPending={isDisconnecting}
        onConfirm={() => disconnectStripe()}
        onOpenChange={setOpen}
        open={open}
        title="Disconnect Stripe?"
        trigger={
          <Button
            className="text-destructive hover:text-destructive"
            size="sm"
            variant="ghost"
          >
            Disconnect Stripe
          </Button>
        }
      />
    </div>
  );
}

/**
 * Turns the raw Stripe account signals into one plain-English sentence.
 *
 * Charges/payouts being "Off" right after onboarding is almost always Stripe
 * still verifying the account — but we only say "up to 24 hours" when Stripe
 * actually reports that (`disabledReason` / empty requirements), never as a
 * blanket assumption. Returns null once everything is live (the "Active" badge
 * already covers that case).
 */
function paymentsStatusMessage(
  status: StripeConnectStatus | null
): string | null {
  if (!status) return null;

  const { chargesEnabled, payoutsEnabled, disabledReason } = status;
  const requirementsDue = status.requirementsCurrentlyDue ?? [];

  // Fully live — nothing to explain.
  if (chargesEnabled && payoutsEnabled) return null;

  // Stripe needs more information from the merchant to proceed.
  if (
    requirementsDue.length > 0 ||
    disabledReason === 'requirements.past_due'
  ) {
    return 'Stripe needs a few more details before you can take payments. Use the button below to finish.';
  }

  // Account is under manual review by Stripe.
  if (
    disabledReason === 'under_review' ||
    disabledReason === 'requirements.pending_review'
  ) {
    return 'Stripe is reviewing your details. We’ll enable payments automatically once it’s approved — no action needed.';
  }

  // Blocked states that the merchant can't self-resolve.
  if (
    disabledReason === 'rejected.fraud' ||
    disabledReason === 'rejected.terms_of_service' ||
    disabledReason === 'rejected.listed' ||
    disabledReason === 'rejected.other' ||
    disabledReason === 'listed' ||
    disabledReason === 'platform_paused'
  ) {
    return 'Stripe has placed a hold on this account. Please contact support to resolve it.';
  }

  // Default: details submitted, no outstanding requirements → pending verification.
  // This is the "up to 24 hours" case Stripe surfaces after onboarding.
  return 'Your details are submitted and Stripe is verifying your account. This usually takes up to 24 hours — payments turn on automatically once you’re approved.';
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Badge variant={ok ? 'default' : 'secondary'}>
      {label}: {ok ? 'On' : 'Off'}
    </Badge>
  );
}
