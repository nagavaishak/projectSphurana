import { MobileBottomSheet } from '@/components/mobile-bottom-sheet';
import { useCheckoutStore } from '@/features/sales/store/checkout-store';
import { useResolvedRoutes } from '@/lib/use-routes';
import { useNavigate } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import {
  Banknote,
  CalendarOff,
  CalendarPlus,
  ChevronRight,
  ShoppingCart,
} from 'lucide-react';

export interface MobileQuickAddSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The `+` tab's action sheet. Mirrors the desktop calendar `AddMenu` (see
 * `components/calendar/components/header/add-menu.tsx`), but reaches the same
 * flows without the calendar context: appointments and blocked time are
 * full-screen mobile routes, sale and quick payment are globally-mounted sheets
 * driven by the checkout store.
 */
export function MobileQuickAddSheet({
  open,
  onOpenChange,
}: MobileQuickAddSheetProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const openCheckout = useCheckoutStore((state) => state.openCheckout);
  const startQuickPayment = useCheckoutStore(
    (state) => state.startQuickPayment
  );

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };

  return (
    <MobileBottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Add new"
      titleClassName="px-5 pb-2 text-[17px] font-semibold text-[#0A0A0A]"
      contentBased
    >
      <ul className="flex flex-col px-3 pb-2">
        <QuickAddRow
          icon={CalendarPlus}
          label="Appointment"
          description="Book a client in"
          testId="quick-add-appointment"
          onClick={() => run(() => navigate({ to: routes.calendarNew }))}
        />
        <QuickAddRow
          icon={CalendarOff}
          label="Blocked time"
          description="Break, holiday or admin time"
          testId="quick-add-blocked-time"
          onClick={() => run(() => navigate({ to: routes.calendarNewBlock }))}
        />
        <QuickAddRow
          icon={ShoppingCart}
          label="Sale"
          description="Sell services, products or gift cards"
          testId="quick-add-sale"
          onClick={() => run(() => openCheckout())}
        />
        <QuickAddRow
          icon={Banknote}
          label="Quick payment"
          description="Take a one-off amount"
          testId="quick-add-quick-payment"
          onClick={() => run(() => startQuickPayment())}
        />
      </ul>
    </MobileBottomSheet>
  );
}

function QuickAddRow({
  icon: Icon,
  label,
  description,
  testId,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  description: string;
  testId: string;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        id={testId}
        data-testid={testId}
        className="flex w-full items-center gap-3.5 rounded-2xl px-2 py-3.5 text-left transition active:bg-black/[0.04]"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Icon className="size-5 text-primary" strokeWidth={2} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-[#0A0A0A]">
            {label}
          </span>
          <span className="block truncate text-[13px] text-[#737373]">
            {description}
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-[#C7C7CC]" aria-hidden />
      </button>
    </li>
  );
}
