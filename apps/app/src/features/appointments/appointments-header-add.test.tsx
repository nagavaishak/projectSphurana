import { renderWithProviders, screen } from '@/test/render';
import { describe, expect, it, vi } from 'vitest';

/**
 * AppointmentsHeader add-action wiring.
 *
 * The Fresha-style resource header (config.dayColumnsPerStaff) is shared by the
 * appointments calendar AND the content planner. Appointments have two add modes
 * (event + blocked time) → the "Add" split menu. The content planner has a
 * single custom add dialog and no secondary dialog; it must render a DIRECT
 * "Schedule Content" button whose trigger child opens the (uncontrolled)
 * AddContentDialog — the split menu drives dialogs in controlled mode, which
 * AddContentDialog does not support, so the menu path never opens it.
 *
 * useCalendar is stubbed per-case via a mutable holder; the heavy toolbar
 * sub-components are stubbed to no-ops so the header renders without their
 * queries/providers.
 */

const calendarState: { config: Record<string, unknown> } = { config: {} };

vi.mock('@/components/calendar/contexts/calendar-context', () => ({
  useCalendar: () => ({
    config: calendarState.config,
    selectedDate: new Date('2026-07-11T00:00:00Z'),
    setSelectedDate: vi.fn(),
  }),
}));

vi.mock('@/components/calendar/components/header/date-picker-popover', () => ({
  DatePickerPopover: () => null,
}));
vi.mock('@/components/calendar/components/header/team-select', () => ({
  TeamSelect: () => null,
}));
vi.mock('@/components/calendar/components/header/view-select', () => ({
  ViewSelect: () => null,
}));
vi.mock('@/components/calendar/components/header/refresh-button', () => ({
  RefreshButton: () => null,
}));

const noop = () => null;
// Keep the real AddMenu but stub its dropdown so the trigger renders in jsdom.
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
  DropdownMenuItem: ({ children }: { children?: React.ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

import { AppointmentsHeader } from '@/components/calendar/components/header/appointments-header';

// Content-style dialog: uncontrolled, opens from a trigger child (like AddContentDialog).
function ContentDialog({ children }: { children?: React.ReactNode }) {
  return <div data-testid="content-dialog-wrapper">{children}</div>;
}

describe('AppointmentsHeader add action', () => {
  it('renders a direct add button when the config has no secondary dialog (content planner)', () => {
    calendarState.config = {
      dayColumnsPerStaff: true,
      customAddDialog: ContentDialog,
      labels: { addButton: 'Schedule Content', eventLabel: 'Content' },
    };

    renderWithProviders(
      <AppointmentsHeader view="week" events={[]} basePath="/x" />
    );

    // Direct CTA present with the config label...
    expect(
      screen.getByRole('button', { name: 'Schedule Content' })
    ).toBeVisible();
    // ...and it is wrapped by the custom dialog's trigger (not the Add menu).
    expect(screen.getByTestId('content-dialog-wrapper')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Add$/ })).toBeNull();
  });

  it('renders the split Add menu when the config has a secondary dialog (appointments)', () => {
    calendarState.config = {
      dayColumnsPerStaff: true,
      customAddDialog: noop,
      secondaryAddDialog: noop,
      labels: { addButton: 'Add Appointment', eventLabel: 'Appointment' },
    };

    renderWithProviders(
      <AppointmentsHeader view="week" events={[]} basePath="/x" />
    );

    // The split menu trigger ("Add") is shown, not the direct content button.
    expect(screen.getByRole('button', { name: /Add/ })).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Schedule Content' })
    ).toBeNull();
  });
});
