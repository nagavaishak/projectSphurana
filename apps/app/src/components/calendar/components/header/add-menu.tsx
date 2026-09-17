import {
  Banknote,
  CalendarOff,
  CalendarPlus,
  ChevronDown,
  Plus,
  ShoppingCart,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';
import { useCheckoutStore } from '@/features/sales/store/checkout-store';

type AddMode = 'appointment' | 'blocked' | null;

/**
 * Header "Add" split button. Opens either the appointment dialog
 * (config.customAddDialog) or the blocked-time dialog
 * (config.secondaryAddDialog), both driven in controlled mode so the menu
 * item can open them directly.
 */
export function AddMenu() {
  const { config, selectedDate } = useCalendar();
  const AddDialog = config.customAddDialog;
  const BlockedDialog = config.secondaryAddDialog;
  const openCheckout = useCheckoutStore((s) => s.openCheckout);
  const startQuickPayment = useCheckoutStore((s) => s.startQuickPayment);
  const [mode, setMode] = useState<AddMode>(null);

  const close = (open: boolean) => {
    if (!open) setMode(null);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="gap-1.5">
            <Plus className="size-4" />
            Add
            <ChevronDown className="size-4 opacity-80" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {AddDialog && (
            <DropdownMenuItem onSelect={() => setMode('appointment')}>
              <CalendarPlus className="size-4" />
              {config.labels.eventLabel}
            </DropdownMenuItem>
          )}
          {BlockedDialog && (
            <DropdownMenuItem onSelect={() => setMode('blocked')}>
              <CalendarOff className="size-4" />
              Blocked time
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => openCheckout()}>
            <ShoppingCart className="size-4" />
            Sale
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => startQuickPayment()}>
            <Banknote className="size-4" />
            Quick payment
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/*
        `startDate={selectedDate}` — the day the user is LOOKING AT, not today.
        Without it the dialog fell back to `new Date()`, so opening "Add" while
        viewing Wed 2 Sept produced a form pre-filled with Aug 30. The date is
        editable, so the wrong value is easy to miss and the booking silently
        lands on the wrong day. The per-practitioner column menu
        (`staff-header-menu.tsx`) already passed it; this path did not.
      */}
      {AddDialog && (
        <AddDialog
          open={mode === 'appointment'}
          onOpenChange={close}
          startDate={selectedDate}
        />
      )}
      {BlockedDialog && (
        <BlockedDialog
          open={mode === 'blocked'}
          onOpenChange={close}
          startDate={selectedDate}
        />
      )}
    </>
  );
}
