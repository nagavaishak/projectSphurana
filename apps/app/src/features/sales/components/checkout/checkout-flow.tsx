import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { AppointmentQuickActions } from '@/features/appointments';
import { useGetAppointment } from '@/features/appointments';
import { cn } from '@/lib/utils';
import type {
  AddSaleItemInput,
  SaleItem,
  SaleWithRelations,
  SetSaleTipInput,
} from '@borradh-workspace/api-client/types';
import {
  ChevronRightIcon,
  ChevronUpIcon,
  Loader2Icon,
  MoreVerticalIcon,
  ShoppingCartIcon,
  UserPlusIcon,
  XIcon,
} from 'lucide-react';
import { useState } from 'react';
import {
  useAddSaleItem,
  useCompleteSale,
  useRemoveSaleItem,
  useSetSaleClient,
  useSetSaleTip,
} from '../../api';
import { formatMoney } from '../../lib/money';
import { AddItemBar } from './add-item-bar';
import { CartSummary } from './cart-summary';
import { ClientPickerDialog } from './client-picker-dialog';
import { PaymentPanel } from './payment-panel';
import { ReceiptSummary } from './receipt-summary';
import { TipSelector } from './tip-selector';

type Step = 'cart' | 'tip' | 'payment' | 'done';

const STEP_LABELS: { key: Exclude<Step, 'done'>; label: string }[] = [
  { key: 'cart', label: 'Cart' },
  { key: 'tip', label: 'Tip' },
  { key: 'payment', label: 'Payment' },
];

interface CheckoutFlowProps {
  sale: SaleWithRelations;
  /** Leave checkout (back to the originating screen). */
  onExit: () => void;
  /** Start a brand-new sale. */
  onNewSale: () => void;
  /** Step to open on. Defaults to 'cart'; quick payment starts at 'tip'. */
  initialStep?: Step;
  /** Auto-open the gift-card selection grid on mount ("Sell gift card"). */
  sellGiftCard?: boolean;
}

function paidCents(sale: SaleWithRelations): number {
  return sale.payments
    .filter((p) => p.status === 'succeeded')
    .reduce((sum, p) => sum + p.amountCents, 0);
}

function clientName(sale: SaleWithRelations): string | null {
  if (!sale.lead) return null;
  return [sale.lead.firstName, sale.lead.lastName].filter(Boolean).join(' ');
}

/**
 * Orchestrates the POS checkout inside the wide checkout sheet: a three-region
 * layout (close + breadcrumb header, step content on the left, a persistent
 * cart panel on the right). Build the cart, choose a tip, take payment, then
 * complete and show a receipt.
 */
export function CheckoutFlow({
  sale,
  onExit,
  onNewSale,
  initialStep = 'cart',
  sellGiftCard = false,
}: CheckoutFlowProps) {
  const [step, setStep] = useState<Step>(initialStep);
  const [removingItemId, setRemovingItemId] = useState<string | null>(null);
  const [pricingItemId, setPricingItemId] = useState<string | null>(null);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);

  const { addSaleItemAsync, isAdding } = useAddSaleItem(sale.id);
  const { removeSaleItemAsync } = useRemoveSaleItem(sale.id);
  const { setSaleTipAsync, isSettingTip } = useSetSaleTip(sale.id);
  const { setSaleClientAsync } = useSetSaleClient(sale.id);
  const { completeSaleAsync, isCompleting } = useCompleteSale(sale.id, {
    onSuccess: () => setStep('done'),
  });

  // Fetch the linked appointment (status/start/end aren't on the sale line;
  // cached, disabled when there's none). MUST stay above the early return
  // below so the hook count is stable once the sale completes.
  const appointmentLine = sale.items.find(
    (item) => item.itemType === 'appointment' && item.appointmentId
  );
  const linkedAppointmentId = appointmentLine?.appointmentId ?? null;
  const { appointment: linkedAppointment } = useGetAppointment(
    linkedAppointmentId ?? ''
  );

  const handleAdd = (input: AddSaleItemInput) => addSaleItemAsync(input);

  const handleRemove = async (itemId: string) => {
    setRemovingItemId(itemId);
    try {
      await removeSaleItemAsync(itemId);
    } finally {
      setRemovingItemId(null);
    }
  };

  // No update-item endpoint exists (only add + remove), so a price override is
  // remove-then-re-add: drop the old line and re-create it at the new unit
  // price, carrying over its type, entity reference, staff and quantity.
  const handleEditPrice = async (item: SaleItem, unitPriceCents: number) => {
    if (unitPriceCents === item.unitPriceCents) return;
    setPricingItemId(item.id);
    try {
      await removeSaleItemAsync(item.id);
      const input: AddSaleItemInput = {
        itemType: item.itemType,
        name: item.name,
        quantity: item.quantity,
        unitPriceCents,
        ...(item.appointmentId ? { appointmentId: item.appointmentId } : {}),
        ...(item.serviceId ? { serviceId: item.serviceId } : {}),
        ...(item.productId ? { productId: item.productId } : {}),
        ...(item.membershipPlanId
          ? { membershipPlanId: item.membershipPlanId }
          : {}),
        ...(item.practitionerId ? { practitionerId: item.practitionerId } : {}),
        // Gift-card lines carry a separate face value + expiry — preserve them
        // so a price override stays a manual discount, not a value change.
        ...(item.giftCardFaceValueCents != null
          ? { giftCardFaceValueCents: item.giftCardFaceValueCents }
          : {}),
        ...(item.giftCardExpiry
          ? {
              giftCardExpiry: item.giftCardExpiry as NonNullable<
                AddSaleItemInput['giftCardExpiry']
              >,
            }
          : {}),
      };
      await addSaleItemAsync(input);
    } finally {
      setPricingItemId(null);
    }
  };

  const handleTip = (input: SetSaleTipInput) => setSaleTipAsync(input);

  const paid = paidCents(sale);
  const remaining = Math.max(sale.totalCents - paid, 0);
  const isPaid = sale.totalCents > 0 && remaining <= 0;
  const isCompleted = sale.status === 'completed';
  const name = clientName(sale);

  if (step === 'done' || isCompleted) {
    return (
      <div className="flex h-full flex-col">
        <FlowHeader step="payment" onStepChange={setStep} onExit={onExit} />
        <div className="mx-auto w-full max-w-xl flex-1 overflow-y-auto p-8">
          <ReceiptSummary sale={sale} onNewSale={onNewSale} onDone={onExit} />
        </div>
      </div>
    );
  }

  const itemCount = sale.items.reduce((n, item) => n + item.quantity, 0);

  // Cart body (client + line items) — shared by the desktop aside and the
  // mobile cart Sheet so the two viewports never drift.
  const cartBody = (
    <>
      {/* Client — tap to attach/change/remove the client on this sale. */}
      <button
        type="button"
        onClick={() => setClientPickerOpen(true)}
        className="flex w-full items-center justify-between rounded-xl border p-4 text-left transition-colors hover:bg-accent/40"
      >
        <div className="min-w-0">
          <p className="truncate font-semibold">{name ?? 'Add client'}</p>
          <p className="truncate text-sm text-muted-foreground">
            {name
              ? sale.lead?.email || sale.lead?.phone || 'Client'
              : 'Leave empty for walk-ins'}
          </p>
        </div>
        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <UserPlusIcon className="size-5" />
        </div>
      </button>

      <CartSummary
        sale={sale}
        readOnly={step !== 'cart'}
        removingItemId={removingItemId}
        onRemoveItem={handleRemove}
        pricingItemId={pricingItemId}
        onEditPrice={handleEditPrice}
      />

      {step !== 'cart' && (
        <Button
          type="button"
          variant="outline"
          className="w-full rounded-full"
          onClick={() => setStep('cart')}
        >
          <ShoppingCartIcon className="size-4" />
          Add to cart
        </Button>
      )}
    </>
  );

  const totalsRows = (
    <>
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>Total</span>
        <span>{formatMoney(sale.totalCents, sale.currency)}</span>
      </div>
      <div className="flex items-center justify-between text-lg font-bold">
        <span className="flex items-center gap-1">
          To pay
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </span>
        <span>{formatMoney(remaining, sale.currency)}</span>
      </div>
    </>
  );

  // Fresha "Quick actions": if this sale is linked to an appointment (an
  // appointment line item), the ⋮ menu offers Add note / Reschedule / No-show /
  // Cancel on that appointment, keeping New sale / Close checkout below.
  // Walk-in / quick-payment sales have no appointment line → plain menu.
  const moreMenuItems = (
    <>
      <DropdownMenuItem onClick={onNewSale}>New sale</DropdownMenuItem>
      <DropdownMenuItem onClick={onExit}>Close checkout</DropdownMenuItem>
    </>
  );

  const moreMenu = linkedAppointment ? (
    <AppointmentQuickActions
      appointmentId={linkedAppointment.id}
      status={linkedAppointment.status}
      startDate={linkedAppointment.startDate}
      endDate={linkedAppointment.endDate}
      extraItems={moreMenuItems}
    />
  ) : (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-11 shrink-0 rounded-full"
          aria-label="More options"
        >
          <MoreVerticalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">{moreMenuItems}</DropdownMenuContent>
    </DropdownMenu>
  );

  // The step-advancing primary action — identical on both viewports.
  let stepAction: React.ReactNode = null;
  if (step === 'cart') {
    stepAction = (
      <Button
        type="button"
        size="lg"
        className="h-11 flex-1 rounded-full"
        disabled={sale.items.length === 0}
        onClick={() => setStep('tip')}
      >
        Continue
      </Button>
    );
  } else if (step === 'tip') {
    stepAction = (
      <Button
        type="button"
        size="lg"
        className="h-11 flex-1 rounded-full"
        disabled={isSettingTip}
        onClick={() => setStep('payment')}
      >
        Continue to payment
      </Button>
    );
  } else if (step === 'payment') {
    stepAction = isPaid ? (
      <Button
        type="button"
        size="lg"
        className="h-11 flex-1 rounded-full"
        disabled={isCompleting}
        onClick={() => completeSaleAsync()}
      >
        {isCompleting && <Loader2Icon className="mr-2 size-4 animate-spin" />}
        Complete sale
      </Button>
    ) : (
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-11 flex-1 rounded-full"
        onClick={onExit}
      >
        Save unpaid
      </Button>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <FlowHeader step={step} onStepChange={setStep} onExit={onExit} />

      <ClientPickerDialog
        open={clientPickerOpen}
        onOpenChange={setClientPickerOpen}
        hasClient={!!sale.lead}
        onSelect={(leadId) => setSaleClientAsync({ leadId })}
      />

      <div className="flex min-h-0 flex-1">
        {/* Step content */}
        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 md:px-8">
          {step === 'cart' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Add to cart</h2>
              <AddItemBar
                currency={sale.currency}
                disabled={isAdding}
                onAdd={handleAdd}
                autoOpenGiftCard={sellGiftCard}
              />
            </div>
          )}

          {step === 'tip' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-2xl font-bold">Select tip</h2>
                <p className="text-muted-foreground">
                  Select an amount{name ? ` for ${name}` : ''}
                </p>
              </div>
              <TipSelector
                subtotalCents={sale.subtotalCents}
                currency={sale.currency}
                tipCents={sale.tipCents}
                isSaving={isSettingTip}
                onApply={handleTip}
              />
            </div>
          )}

          {step === 'payment' && (
            <div className="space-y-6">
              <h2 className="text-2xl font-bold">Select payment</h2>
              <PaymentPanel sale={sale} />
            </div>
          )}
        </main>

        {/* Cart panel — desktop only; on mobile the cart lives in a bottom
            Sheet driven by the bar below (the fixed 360px aside would collapse
            the step region off-screen at phone widths). */}
        <aside className="hidden w-[360px] shrink-0 flex-col border-l md:flex">
          <div className="flex-1 space-y-4 overflow-y-auto p-5">{cartBody}</div>

          {/* Totals + primary action */}
          <div className="space-y-3 border-t p-5">
            {totalsRows}
            <div className="flex items-center gap-2">
              {moreMenu}
              {stepAction}
            </div>
          </div>
        </aside>
      </div>

      {/* Mobile checkout bar: a persistent total + item count that opens the
          cart in a bottom Sheet, with the same step action always visible.
          `relative z-10 shrink-0` keeps it above the scrollable step `<main>`
          in both paint and hit-test order at phone widths. */}
      <div className="relative z-10 flex shrink-0 flex-col gap-2 border-t bg-background p-4 md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-between rounded-xl border px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2 font-medium">
                <ShoppingCartIcon className="size-4" />
                {itemCount} {itemCount === 1 ? 'item' : 'items'}
              </span>
              <span className="flex items-center gap-1 font-bold">
                {formatMoney(remaining, sale.currency)}
                <ChevronUpIcon className="size-4 text-muted-foreground" />
              </span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="flex max-h-[85vh] flex-col gap-0 p-0"
          >
            <SheetHeader className="border-b text-left">
              <SheetTitle>Cart</SheetTitle>
              <SheetDescription className="sr-only">
                Review the items and totals for this sale.
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {cartBody}
            </div>
            <div className="space-y-3 border-t p-5">{totalsRows}</div>
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2">
          {moreMenu}
          {stepAction}
        </div>
      </div>
    </div>
  );
}

/** Close button + Cart / Tip / Payment breadcrumb. */
function FlowHeader({
  step,
  onStepChange,
  onExit,
}: {
  step: Step;
  onStepChange: (step: Step) => void;
  onExit: () => void;
}) {
  const activeIndex = STEP_LABELS.findIndex((s) => s.key === step);

  return (
    <header className="flex items-center gap-4 border-b px-5 py-4">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 shrink-0 rounded-full border"
        onClick={onExit}
        aria-label="Close checkout"
      >
        <XIcon className="size-4" />
      </Button>
      <nav className="flex items-center gap-2 text-sm">
        {STEP_LABELS.map((s, idx) => {
          const reachable = idx <= activeIndex;
          return (
            <span key={s.key} className="flex items-center gap-2">
              {idx > 0 && (
                <ChevronRightIcon className="size-4 text-muted-foreground" />
              )}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => reachable && onStepChange(s.key)}
                className={cn(
                  'font-medium transition-colors',
                  step === s.key
                    ? 'text-foreground'
                    : reachable
                      ? 'text-muted-foreground hover:text-foreground'
                      : 'text-muted-foreground/60'
                )}
              >
                {s.label}
              </button>
            </span>
          );
        })}
      </nav>
    </header>
  );
}
