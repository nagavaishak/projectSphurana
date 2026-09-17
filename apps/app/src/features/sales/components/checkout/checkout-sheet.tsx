import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Loader2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  useAddSaleItem,
  useCreateSale,
  useCreateSaleFromAppointment,
  useGetSale,
} from '../../api';
import { useCheckoutStore } from '../../store/checkout-store';
import { AmountKeypadDialog } from './amount-keypad-dialog';
import { CheckoutFlow } from './checkout-flow';

/**
 * Quick-payment amount entry. Mounted app-wide next to {@link CheckoutSheet}.
 * Shows ONLY a keypad (no sheet) during the `quickPaymentEntry` phase; a sale is
 * created up front (so we have a currency + id), and on "Continue" the entered
 * amount is added as a `manual` line and the full checkout sheet opens on the
 * tip step. This is why the sheet doesn't slide out until after Continue.
 */
export function QuickPaymentEntry() {
  const active = useCheckoutStore((s) => s.quickPaymentEntry);
  const cancelQuickPayment = useCheckoutStore((s) => s.cancelQuickPayment);
  const openCheckout = useCheckoutStore((s) => s.openCheckout);

  const [saleId, setSaleId] = useState<string | undefined>(undefined);
  const bootstrapped = useRef(false);

  const { createSaleAsync } = useCreateSale();
  const { sale } = useGetSale(saleId ?? '');
  const { addSaleItemAsync, isAdding } = useAddSaleItem(saleId ?? '');

  useEffect(() => {
    if (!active) {
      bootstrapped.current = false;
      setSaleId(undefined);
      return;
    }
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    void (async () => {
      const created = await createSaleAsync({});
      setSaleId(created.id);
    })();
  }, [active, createSaleAsync]);

  if (!active) return null;

  return (
    <AmountKeypadDialog
      open
      onOpenChange={(next) => {
        if (!next) cancelQuickPayment();
      }}
      title="Enter amount"
      submitLabel="Add"
      currency={sale?.currency ?? 'EUR'}
      remaining={0}
      busy={!saleId || isAdding}
      onSubmit={async (cents) => {
        if (!saleId) return;
        await addSaleItemAsync({
          itemType: 'manual',
          name: 'Manual payment',
          quantity: 1,
          unitPriceCents: cents,
        });
        openCheckout({ saleId, quickPayment: true });
      }}
    />
  );
}

/**
 * The wide (~75vw) right-side checkout sheet, mounted once in the dashboard
 * shell. Opens from any entry point via {@link useCheckoutStore}, leaving the
 * calendar (or whatever page is behind it) peeking on the left.
 */
export function CheckoutSheet() {
  const open = useCheckoutStore((s) => s.open);
  const closeCheckout = useCheckoutStore((s) => s.closeCheckout);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) closeCheckout();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-black/40',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            // Mobile: size to the DYNAMIC viewport (100dvh) so the bottom action
            // bar sits inside the visual viewport rather than under the browser
            // chrome (`inset-y-0`/100vh is the taller LAYOUT viewport). Desktop
            // keeps the full-height right sheet via md:inset-y-0.
            'fixed right-0 top-0 z-[60] flex h-[100dvh] w-full flex-col bg-background shadow-lg md:inset-y-0 md:h-auto md:w-[76vw]',
            'border-l outline-none',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right',
            'data-[state=closed]:duration-300 data-[state=open]:duration-500'
          )}
          // Radix requires an accessible title; the flow renders its own visible
          // header, so keep this description-less and title via sr-only below.
          aria-label="Checkout"
        >
          <DialogPrimitive.Title className="sr-only">
            Checkout
          </DialogPrimitive.Title>
          {/* Mount the body only while open so each checkout starts fresh. */}
          {open && <CheckoutSheetBody onClose={closeCheckout} />}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Boots the sale (creating one and seeding an appointment line when opened
 * without a saleId), then hands off to the step-based flow. Mirrors the old
 * routed CheckoutPage, but tracks the sale id in local state instead of the URL.
 */
function CheckoutSheetBody({ onClose }: { onClose: () => void }) {
  const params = useCheckoutStore((s) => s.params);
  const [saleId, setSaleId] = useState<string | undefined>(params.saleId);
  const bootstrapped = useRef(false);

  const { sale, isLoading, isError } = useGetSale(saleId ?? '');
  const { createSaleAsync } = useCreateSale();
  const { createSaleFromAppointmentAsync } = useCreateSaleFromAppointment();

  useEffect(() => {
    if (saleId || bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      if (params.appointmentId) {
        // Seed from the appointment: the server binds the sale to the
        // appointment's client and prices the line from the booked services'
        // snapshot prices, so checkout opens pre-filled (client + price)
        // instead of at €0 with no client.
        const created = await createSaleFromAppointmentAsync({
          appointmentId: params.appointmentId,
        });
        setSaleId(created.id);
        return;
      }

      const created = await createSaleAsync(
        params.leadId ? { leadId: params.leadId } : {}
      );
      setSaleId(created.id);
    })();
  }, [saleId, params, createSaleAsync, createSaleFromAppointmentAsync]);

  const startNewSale = () => {
    bootstrapped.current = false;
    setSaleId(undefined);
  };

  if (!saleId || (isLoading && !sale)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2Icon className="size-6 animate-spin" />
        <p className="text-sm">Starting sale…</p>
      </div>
    );
  }

  if (isError || !sale) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          This sale could not be loaded.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={startNewSale}>
            Start a new sale
          </Button>
        </div>
      </div>
    );
  }

  if (sale.status !== 'open' && sale.status !== 'completed') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted-foreground">
          This sale is {sale.status} and can no longer be edited.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" onClick={startNewSale}>
            New sale
          </Button>
        </div>
      </div>
    );
  }

  return (
    <CheckoutFlow
      sale={sale}
      onExit={onClose}
      onNewSale={startNewSale}
      initialStep={params.quickPayment ? 'tip' : 'cart'}
      sellGiftCard={params.sellGiftCard}
    />
  );
}
