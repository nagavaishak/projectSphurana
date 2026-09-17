import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Focused spec for the shared appointment "Quick actions" ⋮ menu. The radix
 * DropdownMenu is replaced with plain elements so item selection is
 * deterministic in jsdom; the Dialog/AlertDialog respect their `open` prop so
 * the cancel-confirm flow can be driven. The update/delete hooks are mocked to
 * capture the calls each action makes — the real network wiring lives in the
 * hook specs and E2E.
 */

const updateAppointment = vi.fn();
const deleteAppointment = vi.fn();

vi.mock('@/features/appointments/api/update-appointment', () => ({
  useUpdateAppointment: () => ({ updateAppointment, isUpdating: false }),
}));
vi.mock('@/features/appointments/api/delete-appointment', () => ({
  useDeleteAppointment: (opts?: { onSuccess?: () => void }) => ({
    deleteAppointment: (id: string) => {
      deleteAppointment(id);
      opts?.onSuccess?.();
    },
    isDeleting: false,
  }),
}));
vi.mock('@/features/organization', () => ({
  useActiveOrganization: () => ({ data: { timezone: 'UTC' } }),
}));

// Deterministic dropdown: render trigger + items inline, item click = onSelect.
vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuTrigger: ({ children }: { children?: ReactNode }) => (
    <>{children}</>
  ),
  DropdownMenuContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  DropdownMenuItem: ({
    children,
    onSelect,
    disabled,
  }: {
    children?: ReactNode;
    onSelect?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onSelect} disabled={disabled}>
      {children}
    </button>
  ),
}));

// Dialog / AlertDialog: honour `open` so closed dialogs stay unmounted.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogHeader: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children?: ReactNode }) => (
    <p>{children}</p>
  ),
  DialogFooter: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open?: boolean;
    children?: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children?: ReactNode }) => (
    <h2>{children}</h2>
  ),
  AlertDialogDescription: ({ children }: { children?: ReactNode }) => (
    <p>{children}</p>
  ),
  AlertDialogFooter: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogMedia: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTrigger: ({ children }: { children?: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogCancel: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children?: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

import { AppointmentQuickActions } from './appointment-quick-actions';

const baseProps = {
  appointmentId: 'appt-1',
  status: 'booked' as const,
  startDate: '2026-07-11T10:00:00.000Z',
  endDate: '2026-07-11T10:30:00.000Z',
};

describe('AppointmentQuickActions', () => {
  beforeEach(() => {
    updateAppointment.mockClear();
    deleteAppointment.mockClear();
  });

  it('renders the Fresha quick-action items', () => {
    renderWithProviders(<AppointmentQuickActions {...baseProps} />);
    expect(screen.getByRole('button', { name: 'Add a note' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reschedule' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'No-show' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  it('renders extraItems below the built-in actions', () => {
    renderWithProviders(
      <AppointmentQuickActions
        {...baseProps}
        extraItems={<button type="button">New sale</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'New sale' })).toBeVisible();
  });

  it('marks the appointment as no-show', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AppointmentQuickActions {...baseProps} />);

    await user.click(screen.getByRole('button', { name: 'No-show' }));

    expect(updateAppointment).toHaveBeenCalledWith({
      id: 'appt-1',
      status: 'no_show',
    });
  });

  it('disables No-show when already a no-show', () => {
    renderWithProviders(
      <AppointmentQuickActions {...baseProps} status="no_show" />
    );
    expect(screen.getByRole('button', { name: 'No-show' })).toBeDisabled();
  });

  it('confirms before cancelling, then deletes the appointment', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderWithProviders(
      <AppointmentQuickActions {...baseProps} onDone={onDone} />
    );

    // Cancel item only opens the confirm dialog — no delete yet.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteAppointment).not.toHaveBeenCalled();

    // Confirm.
    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(deleteAppointment).toHaveBeenCalledWith('appt-1');
    expect(onDone).toHaveBeenCalled();
  });
});
