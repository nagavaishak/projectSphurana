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
import { Rocket } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  useLinkStripeAccountForOrg,
  useOrganizationOnboarding,
  useSeedSubscription,
} from '../api';

interface OnboardingPanelProps {
  organizationId: string;
}

/**
 * The two ids an onboarding specialist carries back from a sales call.
 *
 * They were separate cards, which read as two unrelated features when they are
 * one job done in one sitting: the customer paid (a subscription) and finished
 * Stripe onboarding (a connected account), and neither fact reaches the
 * product on its own. One card, two fields, in the order they happen.
 */
export function OnboardingPanel({ organizationId }: OnboardingPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Rocket className="size-5" />
          Onboarding
        </CardTitle>
        <CardDescription>
          Attach what the customer set up on the call.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SubscriptionField organizationId={organizationId} />
        <StripeAccountField organizationId={organizationId} />
      </CardContent>
    </Card>
  );
}

/** Shared shape: paste one id, press one button, see what happened. */
function IdField({
  id,
  label,
  description,
  placeholder,
  pattern,
  action,
  isBusy,
  result,
  attached,
}: {
  id: string;
  label: string;
  description: React.ReactNode;
  placeholder: string;
  pattern: RegExp;
  action: (value: string) => void;
  isBusy: boolean;
  result?: string | null;
  /** What is attached RIGHT NOW, read from the server. */
  attached?: string | null;
}) {
  const [value, setValue] = useState('');
  const [touched, setTouched] = useState(false);

  // Show the attached id until someone edits the box. Without this the field
  // is empty on every reload, which reads as "not done" for an org that was
  // onboarded weeks ago — and invites a second subscription onto a workspace
  // that already has one.
  useEffect(() => {
    if (!touched && attached) setValue(attached);
  }, [attached, touched]);
  const trimmed = value.trim();
  const looksValid = pattern.test(trimmed);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!looksValid || isBusy) return;
        // The field KEEPS what was typed. Clearing on submit looks tidy and
        // costs the operator the id every time the attach is refused — a
        // cancelled subscription, an account already claimed elsewhere — which
        // is exactly when they need it still in front of them to check it
        // against Stripe.
        action(trimmed);
      }}
    >
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
        <div className="flex gap-2">
          <Input
            id={id}
            value={value}
            onChange={(e) => {
              setTouched(true);
              setValue(e.target.value);
            }}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            disabled={isBusy}
          />
          <Button type="submit" disabled={!looksValid || isBusy}>
            {isBusy ? 'Attaching…' : 'Attach'}
          </Button>
        </div>
        {result && <p className="text-muted-foreground text-sm">{result}</p>}
      </Field>
    </form>
  );
}

function SubscriptionField({ organizationId }: OnboardingPanelProps) {
  const { onboarding, refetch } = useOrganizationOnboarding(organizationId);
  const { seedSubscription, isSeeding, seeded } = useSeedSubscription(
    organizationId,
    { onSuccess: () => void refetch() }
  );
  const attached = onboarding?.subscription;

  return (
    <IdField
      id="stripe-subscription-ref"
      label="Subscription ID"
      description={
        <>
          The plan they bought on the call — <code>sub_…</code>, or{' '}
          <code>cus_…</code> and we&rsquo;ll find their subscription.
        </>
      }
      placeholder="sub_1A2b3C4d5E6f"
      pattern={/^(sub|cus)_[A-Za-z0-9]+$/}
      action={seedSubscription}
      isBusy={isSeeding}
      attached={attached?.stripeSubscriptionId ?? attached?.stripeCustomerId}
      result={
        seeded || attached
          ? `${seeded?.status ?? attached?.status}${
              (seeded?.currentPeriodEnd ?? attached?.currentPeriodEnd)
                ? ` · renews ${new Date(
                    (seeded?.currentPeriodEnd ??
                      attached?.currentPeriodEnd) as string
                  ).toLocaleDateString()}`
                : ''
            }`
          : null
      }
    />
  );
}

function StripeAccountField({ organizationId }: OnboardingPanelProps) {
  const { onboarding, refetch } = useOrganizationOnboarding(organizationId);
  const { linkStripeAccount, isLinking, linked } = useLinkStripeAccountForOrg(
    organizationId,
    { onSuccess: () => void refetch() }
  );
  const attached = onboarding?.stripeAccount;

  return (
    <IdField
      id="stripe-connect-account"
      label="Stripe Connect account ID"
      description={
        <>
          The account they onboarded from the link below. Find it in Stripe
          under Connect → Accounts; it starts with <code>acct_</code>.
        </>
      }
      placeholder="acct_1A2b3C4d5E6f7G8h"
      pattern={/^acct_[A-Za-z0-9]+$/}
      action={linkStripeAccount}
      isBusy={isLinking}
      attached={attached?.stripeAccountId}
      result={
        linked || attached
          ? `charges ${
              (linked ?? attached)?.chargesEnabled ? 'on' : 'off'
            } · payouts ${(linked ?? attached)?.payoutsEnabled ? 'on' : 'off'}`
          : null
      }
    />
  );
}
