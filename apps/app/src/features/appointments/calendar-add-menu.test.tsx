import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Calendar header "Add" split-button, ported from the calendar E2E which drives
 * the header to open the new-appointment and block-off dialogs. Here we assert
 * the header's open-dialog wiring in isolation: selecting the appointment item
 * mounts the appointment dialog open; selecting the blocked-time item mounts the
 * blocked-time dialog open; each is driven in controlled mode so only one opens.
 *
 * useCalendar is stubbed with a config exposing lightweight dialog stubs (the
 * real dialogs are covered by their own form specs). The radix DropdownMenu is
 * replaced with plain elements so item selection is deterministic in jsdom —
 * the menu's own open/close animation is a radix concern and stays E2E.
 */

const customAddDialog = vi.fn(
  ({ open }: { open: boolean; onOpenChange: (o: boolean) => void }) =>
    open ? <div data-testid="appointment-dialog">appointment open</div> : null
);
const secondaryAddDialog = vi.fn(
  ({ open }: { open: boolean; onOpenChange: (o: boolean) => void }) =>
    open ? <div data-testid="blocked-dialog">blocked open</div> : null
);

// The day the user is LOOKING AT — deliberately not today, so a regression to
// `new Date()` cannot accidentally satisfy the assertions below.
const SELECTED_DATE = new Date('2026-09-02T00:00:00Z');

vi.mock('@/components/calendar/contexts/calendar-context', () => ({
  useCalendar: () => ({
    selectedDate: SELECTED_DATE,
    config: {
      customAddDialog,
      secondaryAddDialog,
      labels: { eventLabel: 'Appointment' },
    },
  }),
}));

// Checkout store: capture openCheckout calls so we can assert Sale / Quick
// payment wiring without mounting the app-wide checkout sheet.
const openCheckout = vi.fn();
const startQuickPayment = vi.fn();
vi.mock('@/features/sales/store/checkout-store', () => ({
  useCheckoutStore: (
    selector: (s: {
      openCheckout: () => void;
      startQuickPayment: () => void;
    }) => unknown
  ) => selector({ openCheckout, startQuickPayment }),
}));

// Deterministic dropdown: render trigger + items inline, item click = onSelect.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onSelect,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <button type="button" onClick={onSelect}>
      {children}
    </button>
  ),
}));

import { AddMenu } from '@/components/calendar/components/header/add-menu';

describe('Calendar header AddMenu', () => {
  beforeEach(() => {
    openCheckout.mockClear();
    startQuickPayment.mockClear();
  });

  it('renders both add options using the config label', () => {
    renderWithProviders(<AddMenu />);
    // The config's eventLabel names the appointment item.
    expect(screen.getByRole('button', { name: 'Appointment' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Blocked time' })).toBeVisible();
    // The two checkout entry points render alongside the dialog items.
    expect(screen.getByRole('button', { name: 'Sale' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Quick payment' })).toBeVisible();
    // Neither dialog is open until an item is chosen.
    expect(screen.queryByTestId('appointment-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('blocked-dialog')).not.toBeInTheDocument();
  });

  it('opens an empty checkout when the Sale item is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddMenu />);

    await user.click(screen.getByRole('button', { name: 'Sale' }));

    expect(openCheckout).toHaveBeenCalledTimes(1);
    // Empty walk-in sale — no params.
    expect(openCheckout).toHaveBeenCalledWith();
  });

  it('starts quick-payment amount entry when the Quick payment item is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddMenu />);

    await user.click(screen.getByRole('button', { name: 'Quick payment' }));

    // Quick payment shows the keypad first (no sheet) — it must NOT openCheckout.
    expect(startQuickPayment).toHaveBeenCalledTimes(1);
    expect(openCheckout).not.toHaveBeenCalled();
  });

  it('opens the new-appointment dialog when the appointment item is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddMenu />);

    await user.click(screen.getByRole('button', { name: 'Appointment' }));

    expect(await screen.findByTestId('appointment-dialog')).toBeVisible();
    // The block dialog is not opened.
    expect(screen.queryByTestId('blocked-dialog')).not.toBeInTheDocument();
    // Appointment dialog was rendered in the open state.
    expect(customAddDialog).toHaveBeenCalledWith(
      expect.objectContaining({ open: true }),
      undefined
    );

    // ENG-816: the dialog must be seeded with the day being VIEWED.
    //
    // This path passed no `startDate` at all, so the dialog's defaults fell
    // back to `new Date()` — open "Add" while viewing Wed 2 Sept and the form
    // came up on today's date. The field is editable, so the wrong day is easy
    // to miss and the booking lands silently on it.
    expect(customAddDialog).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: SELECTED_DATE }),
      undefined
    );
  });

  it('opens the block-off-time dialog when the blocked-time item is selected', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AddMenu />);

    await user.click(screen.getByRole('button', { name: 'Blocked time' }));

    expect(await screen.findByTestId('blocked-dialog')).toBeVisible();
    expect(screen.queryByTestId('appointment-dialog')).not.toBeInTheDocument();
    expect(secondaryAddDialog).toHaveBeenCalledWith(
      expect.objectContaining({ open: true }),
      undefined
    );
  });
});
