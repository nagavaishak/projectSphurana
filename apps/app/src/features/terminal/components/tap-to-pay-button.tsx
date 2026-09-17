/**
 * "Charge on this phone" — the minimal Tap to Pay entry point.
 *
 * A single button that opens a progress dialog and drives the charge through
 * `useTapToPay`. On native + capable devices it collects a card via Tap to Pay
 * (or the simulated reader in development); on web it renders nothing so the
 * surrounding checkout can fall back to another tender.
 */

import { CheckCircle2, CreditCard, Smartphone, XCircle } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';

import { useTapToPay } from '../hooks/use-tap-to-pay';
import { type TerminalError, terminalPhaseLabels } from '../lib/terminal-types';

type ButtonVariant = React.ComponentProps<typeof Button>['variant'];
type ButtonSize = React.ComponentProps<typeof Button>['size'];

export interface TapToPayButtonProps {
  /**
   * PaymentIntent **client secret** for a `card_terminal` tender
   * (`terminalClientSecret` from the add-sale-payment response).
   */
  clientSecret: string;
  /** Charge amount in the currency's minor unit (e.g. cents), for display only. */
  amount: number;
  /** ISO currency code (e.g. `"eur"`, `"gbp"`), for display only. */
  currency: string;
  /** Stripe Terminal Location id (`tml_…`) for real Tap to Pay discovery. */
  locationId?: string;
  /** Merchant name shown on the Tap to Pay sheet. */
  merchantDisplayName?: string;
  /** Fired once the PaymentIntent is confirmed. */
  onSuccess?: () => void;
  /** Fired when the charge fails or is canceled. */
  onError?: (error: TerminalError) => void;
  /** Visual style of the trigger button. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  /** Override the trigger label. */
  children?: React.ReactNode;
  /** Force-hide the button even on native (e.g. account not payment-ready). */
  disabled?: boolean;
}

function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function TapToPayButton({
  clientSecret,
  amount,
  currency,
  locationId,
  merchantDisplayName,
  onSuccess,
  onError,
  variant = 'default',
  size,
  className,
  children,
  disabled,
}: TapToPayButtonProps) {
  const {
    isAvailable,
    isSimulated,
    phase,
    isCollecting,
    error,
    collectPayment,
    cancel,
    reset,
  } = useTapToPay();
  const [open, setOpen] = useState(false);

  const start = useCallback(async () => {
    setOpen(true);
    try {
      await collectPayment({ clientSecret, locationId, merchantDisplayName });
      onSuccess?.();
    } catch (err) {
      onError?.(err as TerminalError);
    }
  }, [
    clientSecret,
    locationId,
    merchantDisplayName,
    collectPayment,
    onSuccess,
    onError,
  ]);

  const close = useCallback(() => {
    setOpen(false);
    reset();
  }, [reset]);

  // Not on a Tap to Pay–capable platform — render nothing so checkout can fall
  // back to another tender path.
  if (!isAvailable) return null;

  const amountLabel = formatAmount(amount, currency);
  const isDone =
    phase === 'succeeded' || phase === 'failed' || phase === 'canceled';

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        disabled={disabled}
        onClick={start}
      >
        {children ?? (
          <>
            <Smartphone className="size-4" />
            Charge on this phone
          </>
        )}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // While collecting, keep the dialog open (the tap sheet is modal
          // anyway); allow dismissal once the flow has settled.
          if (!next && !isCollecting) close();
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CreditCard className="size-5" />
              {amountLabel}
            </DialogTitle>
            <DialogDescription>
              {isSimulated
                ? 'Simulated reader (development build).'
                : 'Tap to Pay on this device.'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center gap-3 py-6 text-center">
            {phase === 'succeeded' ? (
              <CheckCircle2 className="size-10 text-success" />
            ) : phase === 'failed' || phase === 'canceled' ? (
              <XCircle className="size-10 text-destructive" />
            ) : (
              <Spinner className="size-8" />
            )}
            <p className="text-sm font-medium">{terminalPhaseLabels[phase]}</p>
            {error && (
              <p className="text-xs text-muted-foreground">
                {error.declineCode
                  ? `${error.message} (${error.declineCode})`
                  : error.message}
              </p>
            )}
          </div>

          <DialogFooter>
            {isCollecting ? (
              <Button variant="outline" onClick={() => void cancel()}>
                Cancel
              </Button>
            ) : (
              isDone && (
                <Button variant="outline" onClick={close}>
                  Done
                </Button>
              )
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
