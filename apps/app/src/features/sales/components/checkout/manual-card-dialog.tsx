import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { loadStripeWithCapture } from '@/lib/stripe-loader';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js';
import type { Stripe } from '@stripe/stripe-js';
import { AlertCircleIcon, Loader2Icon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatMoney } from '../../lib/money';

interface ManualCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** PaymentIntent client secret (null = still creating it server-side). */
  clientSecret: string | null;
  /** Connected account the client secret belongs to. */
  connectedAccountId: string | null;
  amountCents: number;
  currency: string;
  /** Fired once the card is confirmed — the webhook settles the tender. */
  onPaid: () => void;
}

/**
 * Manual (keyed) card entry via Stripe Elements. The amount is fixed to the
 * outstanding balance server-side — the cashier only enters card details. On
 * confirmation the PaymentIntent succeeds and the connect webhook settles the
 * pending `sale_payment` row.
 */
export function ManualCardDialog({
  open,
  onOpenChange,
  clientSecret,
  connectedAccountId,
  amountCents,
  currency,
  onPaid,
}: ManualCardDialogProps) {
  const { stripePublishableKey } = useRuntimeConfig();

  // Stripe.js can only initialize with BOTH a publishable key (runtime config)
  // and the connected account (from the PaymentIntent response). If either is
  // missing — e.g. STRIPE_PUBLISHABLE_KEY isn't set for this environment — the
  // card form can never render, so surface it instead of spinning forever.
  const canInitStripe = !!stripePublishableKey && !!connectedAccountId;

  // STRIPE_E2E_STUB emits a FAKE PaymentIntent client secret (`pi_e2e_…_secret_e2e`,
  // see StripeConnectStubService.createCardPaymentIntent). Real Stripe.js rejects
  // that format with an `IntegrationError`, which throws out of <Elements> and
  // crashes the whole checkout — so any preview that has BOTH a real publishable
  // key AND the stub (e.g. a preview seeded with a real connected account) can't
  // render this dialog. Detect the stub secret and skip real Elements: under the
  // stub there is nothing to collect — E2E settles the tender via an injected
  // webhook. Real client secrets never carry the `pi_e2e_` marker (real
  // PaymentIntent ids have no underscores), so prod is unaffected.
  const isStubClientSecret =
    !!clientSecret && clientSecret.startsWith('pi_e2e_');

  // One Stripe.js instance per connected account. Elements for a direct charge
  // must be loaded with `{ stripeAccount }` so it targets that account.
  const stripePromise = useMemo<Promise<Stripe | null> | null>(() => {
    if (!stripePublishableKey || !connectedAccountId) return null;
    return loadStripeWithCapture(stripePublishableKey, {
      stripeAccount: connectedAccountId,
    });
  }, [stripePublishableKey, connectedAccountId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Card payment · {formatMoney(amountCents, currency)}
          </DialogTitle>
        </DialogHeader>

        {!canInitStripe ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <AlertCircleIcon className="size-8 text-destructive" />
            <p className="text-sm font-medium">Card payments are unavailable</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              This device can’t start manual card entry right now. Use QR
              self-checkout or another payment method, and contact support if it
              persists.
            </p>
          </div>
        ) : isStubClientSecret ? (
          // Stubbed Stripe (STRIPE_E2E_STUB): don't hand a fake client secret to
          // real Stripe.js. No real card entry happens — the tender settles via
          // a simulated webhook — so just show a stub notice.
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">Test mode</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Card entry is stubbed in this environment. The payment settles via
              a simulated webhook.
            </p>
          </div>
        ) : clientSecret && stripePromise ? (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: { theme: 'stripe' } }}
          >
            <CardForm
              onPaid={onPaid}
              amountCents={amountCents}
              currency={currency}
            />
          </Elements>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-10">
            <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Preparing secure card form…
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CardForm({
  onPaid,
  amountCents,
  currency,
}: {
  onPaid: () => void;
  amountCents: number;
  currency: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    // `redirect: 'if_required'` keeps the flow in-dialog for card payments
    // (no redirect-based methods are enabled on the PaymentIntent).
    const result = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });
    if (result.error) {
      setError(result.error.message ?? 'Card payment failed. Try again.');
      setSubmitting(false);
      return;
    }
    onPaid();
  };

  return (
    <div className="space-y-4">
      <PaymentElement options={{ layout: 'tabs' }} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button
        type="button"
        className="w-full rounded-full"
        disabled={!stripe || !elements || submitting}
        onClick={handleConfirm}
      >
        {submitting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
        Pay {formatMoney(amountCents, currency)}
      </Button>
    </div>
  );
}
