import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { CheckCircle2, CreditCard } from 'lucide-react';
import type { UseFormReturn } from 'react-hook-form';

interface Step6StripeConnectProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
  onConnectStripe: () => void;
  isConnectingStripe?: boolean;
}

/**
 * Step 6: Stripe Connect
 * Connect Stripe to collect deposits. Skippable.
 */
export function Step6StripeConnect({
  form,
  onConnectStripe,
  isConnectingStripe,
}: Step6StripeConnectProps) {
  const stripeConnected: boolean = form.watch('stripeConnected') || false;

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Connect your payment account</h1>
        <p className="text-muted-foreground">
          Connect Stripe to collect deposits from clients when they book
          appointments. You can skip this and set it up later.
        </p>
      </div>

      <div
        className={`flex flex-col items-center gap-4 rounded-lg border p-8 ${
          stripeConnected
            ? 'border-green-300 bg-green-50 dark:border-green-800 dark:bg-green-950/20'
            : 'border-border'
        }`}
      >
        <div
          className={`flex h-14 w-14 items-center justify-center rounded-full ${
            stripeConnected ? 'bg-green-100 dark:bg-green-900/40' : 'bg-muted'
          }`}
        >
          {stripeConnected ? (
            <CheckCircle2 className="h-7 w-7 text-green-600" />
          ) : (
            <CreditCard className="h-7 w-7 text-muted-foreground" />
          )}
        </div>

        {stripeConnected ? (
          <>
            <div className="text-center">
              <p className="font-medium text-green-700 dark:text-green-400">
                Stripe Connected
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                You can now collect deposits from clients.
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="text-center">
              <p className="font-medium">Stripe</p>
              <p className="text-sm text-muted-foreground mt-1">
                Accept payments securely with Stripe. Set up takes less than 2
                minutes.
              </p>
            </div>
            <Button
              type="button"
              onClick={onConnectStripe}
              disabled={isConnectingStripe}
            >
              {isConnectingStripe ? 'Connecting...' : 'Connect with Stripe'}
            </Button>
          </>
        )}
      </div>
    </FieldGroup>
  );
}
