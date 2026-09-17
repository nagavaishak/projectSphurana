import { QRCode } from '@/components/kibo-ui/qr-code';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useGetGiftCardByCode } from '@/features/gift-cards/api';
import { useGetAccountStatus } from '@/features/stripe-connect/api/get-account-status';
import { ROUTES } from '@/lib/route-paths';
import { cn } from '@/lib/utils';
import type {
  AddSalePaymentInput,
  AddSalePaymentResponse,
  SalePaymentMethod,
  SaleWithRelations,
} from '@borradh-workspace/api-client/types';
import {
  salePaymentMethodLabels,
  salePaymentStatusLabels,
} from '@borradh-workspace/api-client/types';
import {
  BanknoteIcon,
  CreditCardIcon,
  GiftIcon,
  Loader2Icon,
  QrCodeIcon,
  SmartphoneIcon,
  WalletIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  useAddSalePayment,
  useCancelSalePayment,
  useSettleCardPayment,
} from '../../api';
import { formatMoney } from '../../lib/money';
import { AmountKeypadDialog } from './amount-keypad-dialog';
import { ManualCardDialog } from './manual-card-dialog';

interface PaymentPanelProps {
  sale: SaleWithRelations;
}

/** In-person tenders that settle immediately without touching Stripe. */
const OFFLINE_METHODS: SalePaymentMethod[] = ['cash', 'gift_card'];
/**
 * Card tenders routed through the org's Stripe Connect account. Only offered
 * when that account can actually take a charge: `add-sale-payment` rejects
 * every one of these with INVALID_STATE otherwise, so showing them hands the
 * cashier a dead button mid-sale.
 */
const CONNECT_BASIC_METHODS: SalePaymentMethod[] = ['manual_card'];
const CONNECT_PROCESSED_METHODS: SalePaymentMethod[] = ['qr_self_checkout'];

// Every method needs an icon for the settled-tenders list, including the ones
// absent from the pickers above — `card_terminal` and `deposit` are never
// operator-selectable, but both still render once settled.
const METHOD_ICON: Record<SalePaymentMethod, typeof BanknoteIcon> = {
  cash: BanknoteIcon,
  card_terminal: SmartphoneIcon,
  qr_self_checkout: QrCodeIcon,
  manual_card: CreditCardIcon,
  gift_card: GiftIcon,
  deposit: WalletIcon,
  online_checkout: CreditCardIcon,
};

/** Sum of settled (succeeded) tenders. */
function paidCents(sale: SaleWithRelations): number {
  return sale.payments
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + p.amountCents, 0);
}

/**
 * Payment step. Supports split payment across multiple tenders until the sale
 * is fully covered. Cash / manual card / gift card settle immediately; card
 * terminal returns a PaymentIntent client secret for reader collection; QR
 * self-checkout renders a Stripe Payment Link as a scannable code.
 *
 * Amount entry happens in a keypad dialog per method. QR self-checkout skips
 * the keypad entirely — it always charges the full outstanding balance and
 * shows the scannable code in a large dialog.
 *
 * The Stripe-backed tenders (manual card, QR self-checkout) are only offered
 * when the org's Connect account can take a charge; without one the chooser is
 * cash + gift card, with a pointer at payment settings.
 */
export function PaymentPanel({ sale }: PaymentPanelProps) {
  const paid = paidCents(sale);
  const remaining = Math.max(sale.totalCents - paid, 0);
  const currency = sale.currency;

  // The method whose amount keypad is open (null = chooser only). QR never
  // sets this — it settles immediately without prompting for an amount.
  const [method, setMethod] = useState<SalePaymentMethod | null>(null);
  const [giftCardCode, setGiftCardCode] = useState('');
  const [giftCardLookup, setGiftCardLookup] = useState('');
  // The QR dialog opens as soon as it's requested; `qrUrl` fills in once the
  // Stripe payment link comes back (null = still generating).
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [terminalPending, setTerminalPending] = useState(false);
  // Manual (keyed) card entry via Stripe Elements. `cardClientSecret` fills in
  // once the PaymentIntent is created server-side (null = still preparing).
  const [manualCardOpen, setManualCardOpen] = useState(false);
  const [cardClientSecret, setCardClientSecret] = useState<string | null>(null);
  const [cardAccountId, setCardAccountId] = useState<string | null>(null);
  const [cardPaymentId, setCardPaymentId] = useState<string | null>(null);

  // A QR tender that hasn't settled yet. Reused to avoid minting a second
  // Stripe payment link (and a second pending row) when QR is re-selected.
  const hasPendingQr = sale.payments.some(
    (p) => p.method === 'qr_self_checkout' && p.status === 'pending'
  );

  // Once the QR / terminal tender settles server-side, the polling sale query
  // (see get-sale.hook.ts) refetches and the pending payment row flips to a
  // settled status. Dismiss the waiting dialogs automatically so the cashier
  // doesn't have to refresh or click "Done".
  const hasPendingTender = sale.payments.some((p) => p.status === 'pending');
  useEffect(() => {
    if (!hasPendingTender) {
      setQrOpen(false);
      setQrUrl(null);
      setTerminalPending(false);
      setManualCardOpen(false);
      setCardClientSecret(null);
    }
  }, [hasPendingTender]);

  const { addSalePaymentAsync, isPaying } = useAddSalePayment(sale.id);
  const { settleCardPaymentAsync } = useSettleCardPayment(sale.id);
  const { cancelSalePaymentAsync } = useCancelSalePayment(sale.id);

  // Abandon a still-pending tender the cashier explicitly gave up on (the QR
  // "Cancel payment" button, or closing the manual-card / terminal dialog).
  // Deactivates the Stripe object server-side. The balance never depended on
  // it (only captured money counts), so this is purely to stop a live link /
  // uncollected PI and end the checkout poll. Best-effort; a settled tender has
  // no pending row so it's a harmless no-op.
  const abandonPendingTender = (m: SalePaymentMethod) => {
    const row = sale.payments.find(
      (p) => p.method === m && p.status === 'pending'
    );
    if (!row) return;
    void cancelSalePaymentAsync(row.id).catch(() => {
      /* best-effort; completing/voiding the sale cleans up later */
    });
  };

  // Card tenders route through the org's Stripe Connect account, so only offer
  // them when that account can actually take a charge. `chargesEnabled` is the
  // same flag the payments settings panel calls "Active", and the same one
  // `add-sale-payment` checks before creating any Stripe object. (Read from
  // /account-status, not the /integration hook: that endpoint answers
  // `{ integration }` while `useGetStripeConnection` reads the fields off the
  // envelope, so it reports false for every org.)
  const { status, isLoading: stripeLoading } = useGetAccountStatus();
  const canCharge = status?.chargesEnabled ?? false;
  // Until the status lands, show the offline tenders only. Better a card
  // option that appears a beat late than one that appears and then vanishes,
  // or worse, gets tapped in that beat.
  const basicMethods = canCharge
    ? [...OFFLINE_METHODS, ...CONNECT_BASIC_METHODS]
    : OFFLINE_METHODS;
  const processedMethods = canCharge ? CONNECT_PROCESSED_METHODS : [];

  const { giftCard, isLoading: giftCardLoading } = useGetGiftCardByCode(
    giftCardLookup,
    !!giftCardLookup
  );

  // Gift cards are capped to the card balance and the outstanding balance.
  const chargeFor = (cents: number) =>
    method === 'gift_card' && giftCard
      ? Math.min(cents, giftCard.balanceCents, remaining)
      : cents;

  const openMethod = (m: SalePaymentMethod) => {
    setGiftCardCode('');
    setGiftCardLookup('');
    setTerminalPending(false);
    // Switching methods needs no cleanup: an in-flight tender doesn't hold the
    // balance (only captured money counts), so a new tender is never blocked.
    // A stale intent stays harmless — it's cancelled when the sale completes/
    // voids, or if two ever capture the surplus is refunded at settlement.
    // QR self-checkout always charges the full outstanding balance — no keypad.
    if (m === 'qr_self_checkout') {
      setMethod(null);
      setManualCardOpen(false);
      // Don't mint a second link: while one is generating (isPaying) or already
      // pending, just re-open the existing QR dialog instead of charging again.
      if (isPaying || qrOpen) return;
      if (hasPendingQr) {
        setQrOpen(true);
        return;
      }
      setQrUrl(null);
      setQrOpen(true);
      // If link generation fails the mutation surfaces a toast; drop the
      // spinner dialog so the cashier can retry rather than watch it hang.
      void submit(m, remaining).catch(() => setQrOpen(false));
      return;
    }
    // Manual card entry — no keypad. Charge the full balance and collect the
    // card in a Stripe Elements dialog (no re-entering the amount).
    if (m === 'manual_card') {
      setMethod(null);
      setQrOpen(false);
      setQrUrl(null);
      if (isPaying || manualCardOpen) return;
      setCardClientSecret(null);
      setCardAccountId(null);
      setManualCardOpen(true);
      void submit(m, remaining).catch(() => setManualCardOpen(false));
      return;
    }
    setQrOpen(false);
    setQrUrl(null);
    setManualCardOpen(false);
    setMethod(m);
  };

  const closeKeypad = () => {
    setMethod(null);
    setGiftCardCode('');
    setGiftCardLookup('');
  };

  const handleResult = (result: AddSalePaymentResponse) => {
    if (result.paymentLinkUrl) {
      setQrUrl(result.paymentLinkUrl);
    } else if (result.cardClientSecret) {
      setCardClientSecret(result.cardClientSecret);
      setCardAccountId(result.connectedAccountId ?? null);
      setCardPaymentId(result.salePaymentId ?? null);
    } else if (result.terminalClientSecret) {
      setTerminalPending(true);
    } else {
      // Immediate tender settled — close the keypad.
      closeKeypad();
    }
  };

  const submit = async (payMethod: SalePaymentMethod, cents: number) => {
    const charge =
      payMethod === 'gift_card' && giftCard
        ? Math.min(cents, giftCard.balanceCents, remaining)
        : cents;
    if (charge <= 0) return;
    const input: AddSalePaymentInput = {
      method: payMethod,
      amountCents: charge,
      // Record the tender but leave the sale open — the operator confirms
      // completion with the "Complete sale" button once the balance is covered.
      autoComplete: false,
    };
    if (payMethod === 'card_terminal') input.readerType = 'tap_to_pay';
    if (payMethod === 'gift_card') input.giftCardCode = giftCardCode;
    const result = await addSalePaymentAsync(input);
    handleResult(result);
  };

  const isPaid = remaining <= 0;
  const keypadOpen = method !== null && !terminalPending;
  // Only surface tenders that actually count — a pending row is an in-flight
  // QR/terminal attempt, not a recorded payment.
  const settledTenders = sale.payments.filter((p) => p.status !== 'pending');

  return (
    <div className="space-y-4">
      {/* Balance strip */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="text-lg font-semibold">
            {formatMoney(sale.totalCents, currency)}
          </p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Paid</p>
          <p className="text-lg font-semibold">{formatMoney(paid, currency)}</p>
        </div>
        <div className="rounded-lg border p-3">
          <p className="text-xs text-muted-foreground">Remaining</p>
          <p
            className={cn(
              'text-lg font-semibold',
              isPaid && 'text-green-600 dark:text-green-400'
            )}
          >
            {formatMoney(remaining, currency)}
          </p>
        </div>
      </div>

      {/* Existing tenders — pending (unscanned QR / uncollected terminal)
          tenders are transient and aren't shown; they get cancelled when the
          sale is settled another way. */}
      {settledTenders.length > 0 && (
        <ul className="space-y-1">
          {settledTenders.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-sm"
            >
              <span>{salePaymentMethodLabels[p.method]}</span>
              <span className="flex items-center gap-2">
                <Badge
                  variant={p.status === 'succeeded' ? 'default' : 'secondary'}
                  className="text-[10px]"
                >
                  {salePaymentStatusLabels[p.status]}
                </Badge>
                <span className="font-semibold">
                  {formatMoney(p.amountCents, currency)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {!isPaid && (
        <>
          {/* Method chooser */}
          <div className="space-y-6">
            <MethodGroup
              title="Payment methods"
              methods={basicMethods}
              selected={method}
              onSelect={openMethod}
            />
            {processedMethods.length > 0 && (
              <MethodGroup
                methods={processedMethods}
                selected={method}
                onSelect={openMethod}
              />
            )}
            {!canCharge && !stripeLoading && (
              <p className="px-1 text-sm text-muted-foreground">
                Card payments are unavailable. This location can&rsquo;t take
                charges through Stripe yet.{' '}
                <a
                  href={ROUTES.settingsPayments}
                  className="font-medium text-primary underline underline-offset-2"
                >
                  Set up payments
                </a>
              </p>
            )}
          </div>

          {/* Amount keypad (all methods except QR self-checkout) */}
          {method && (
            <AmountKeypadDialog
              open={keypadOpen}
              onOpenChange={(open) => {
                if (!open) closeKeypad();
              }}
              title={`Add ${salePaymentMethodLabels[method].toLowerCase()} amount`}
              currency={currency}
              remaining={remaining}
              busy={isPaying}
              disabled={method === 'gift_card' && (!giftCard || !giftCardCode)}
              submitLabel={method === 'card_terminal' ? 'Charge' : 'Add'}
              chargeFor={chargeFor}
              onSubmit={(cents) => submit(method, cents)}
              extra={
                method === 'gift_card' && (
                  <div className="space-y-2">
                    <Field>
                      <FieldLabel htmlFor="gc-code">Gift card code</FieldLabel>
                      <div className="flex gap-2">
                        <Input
                          id="gc-code"
                          placeholder="GC-XXXX-XXXX-XXXX"
                          value={giftCardCode}
                          onChange={(e) =>
                            setGiftCardCode(e.target.value.toUpperCase())
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!giftCardCode || giftCardLoading}
                          onClick={() => setGiftCardLookup(giftCardCode)}
                        >
                          {giftCardLoading ? (
                            <Loader2Icon className="size-4 animate-spin" />
                          ) : (
                            'Check'
                          )}
                        </Button>
                      </div>
                    </Field>
                    {giftCard && (
                      <p className="text-sm text-muted-foreground">
                        Balance:{' '}
                        <span className="font-semibold text-foreground">
                          {formatMoney(giftCard.balanceCents, currency)}
                        </span>
                      </p>
                    )}
                    {giftCardLookup && !giftCard && !giftCardLoading && (
                      <p className="text-sm text-destructive">
                        No gift card found for that code.
                      </p>
                    )}
                  </div>
                )
              }
            />
          )}

          {/* Manual (keyed) card entry — Stripe Elements */}
          <ManualCardDialog
            open={manualCardOpen}
            onOpenChange={(open) => {
              if (!open) {
                setManualCardOpen(false);
                // User dismissed the card form without paying — abandon the
                // pending PI so it stops holding the balance. (A successful pay
                // closes via onPaid, not this handler, so it isn't cancelled.)
                abandonPendingTender('manual_card');
              }
            }}
            clientSecret={cardClientSecret}
            connectedAccountId={cardAccountId}
            amountCents={remaining}
            currency={currency}
            onPaid={async () => {
              // The PaymentIntent is confirmed. Settle immediately (verifies the
              // intent server-side and auto-completes the sale) rather than
              // waiting on the async webhook — otherwise the checkout lingers.
              setManualCardOpen(false);
              toast.success('Card payment received');
              if (cardPaymentId) {
                try {
                  await settleCardPaymentAsync(cardPaymentId);
                } catch {
                  // The webhook remains a backstop; polling will settle it.
                }
              }
            }}
          />

          {/* QR self-checkout — large scannable dialog */}
          <Dialog
            open={qrOpen}
            onOpenChange={(open) => {
              // Dismiss only — the client may be mid-payment on their phone.
              // The tender stays live; polling settles + auto-completes it when
              // they pay, even with this popup closed. Abandoning is explicit
              // ("Cancel payment", switching method, or completing the sale).
              if (!open) setQrOpen(false);
            }}
          >
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Scan to pay</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-4 py-2">
                <p className="text-sm text-muted-foreground">
                  Ask the client to scan this code with their phone to pay{' '}
                  <span className="font-semibold text-foreground">
                    {formatMoney(remaining, currency)}
                  </span>
                  .
                </p>
                {qrUrl ? (
                  <>
                    <QRCode data={qrUrl} className="size-72" />
                    <p className="max-w-sm break-all text-center text-xs text-muted-foreground">
                      {qrUrl}
                    </p>
                    <p className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2Icon className="size-3 animate-spin" />
                      Waiting for payment — this updates automatically once
                      paid.
                    </p>
                  </>
                ) : (
                  <div className="flex size-72 flex-col items-center justify-center gap-3 rounded-xl border border-dashed">
                    <Loader2Icon className="size-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">
                      Generating secure payment link…
                    </p>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    className="rounded-full text-muted-foreground"
                    onClick={() => {
                      // Explicit abandon: deactivate the link + expire any open
                      // session so the client can't pay after this, and free the
                      // balance.
                      setQrOpen(false);
                      abandonPendingTender('qr_self_checkout');
                    }}
                  >
                    Cancel payment
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setQrOpen(false)}
                  >
                    Done
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Card terminal awaiting reader */}
          <Dialog
            open={terminalPending}
            onOpenChange={(open) => {
              if (!open) {
                setTerminalPending(false);
                setMethod(null);
                abandonPendingTender('card_terminal');
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Waiting for the card reader…</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
                <p className="max-w-xs text-sm text-muted-foreground">
                  Present the card on the device (Tap to Pay). The tender
                  settles once the reader confirms.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    setTerminalPending(false);
                    setMethod(null);
                    abandonPendingTender('card_terminal');
                  }}
                >
                  Done
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {isPaid && (
        <div className="rounded-lg border border-green-500/40 bg-green-50 p-3 text-center text-sm font-medium text-green-700 dark:bg-green-950/30 dark:text-green-400">
          Payment complete — ready to finish the sale.
        </div>
      )}
    </div>
  );
}

/** A titled grid of large, selectable payment-method cards. */
function MethodGroup({
  title,
  methods,
  selected,
  onSelect,
}: {
  title?: string;
  methods: SalePaymentMethod[];
  selected: SalePaymentMethod | null;
  onSelect: (method: SalePaymentMethod) => void;
}) {
  return (
    <div className="space-y-3">
      {title && (
        <h3 className="text-sm font-semibold text-muted-foreground">{title}</h3>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {methods.map((m) => {
          const Icon = METHOD_ICON[m];
          return (
            <button
              key={m}
              type="button"
              onClick={() => onSelect(m)}
              className={cn(
                'flex h-28 flex-col items-center justify-center gap-2 rounded-xl border text-center transition-colors',
                'hover:bg-muted/40',
                selected === m
                  ? 'border-primary ring-1 ring-primary'
                  : 'border-border'
              )}
            >
              <Icon className="size-6 text-green-600 dark:text-green-500" />
              <span className="text-sm font-medium">
                {salePaymentMethodLabels[m]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
