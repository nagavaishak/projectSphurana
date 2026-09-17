import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Radix Switch (Repeats weekly / Approved) measures its thumb via
// @radix-ui/react-use-size, which needs ResizeObserver — absent in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;

/**
 * TimeOffDialog — form → INTENT behaviour for the D3 scheduling gaps. We mock
 * the create/update/delete feature hooks (`../api`) so the real react-hook-form
 * submit path runs and we can assert the typed intent the component passes. The
 * wire-body assembly (RRULE, org-tz instants, trims) now lives in the mutation
 * hooks' payload builders (see create-time-off.payload.test.ts). The team-member
 * picker is a Radix Select (fiddly to open in jsdom), so create mode is seeded
 * via the `initial.practitionerId` prefill instead of driving the dropdown — the
 * dialog's default type + start/end times make the form valid out of the box.
 */

const createTimeOff = vi.fn();
const updateTimeOff = vi.fn();
const deleteTimeOff = vi.fn();

vi.mock('../api', () => ({
  useCreateTimeOff: () => ({ createTimeOff, isCreating: false }),
  useUpdateTimeOff: () => ({ updateTimeOff, isUpdating: false }),
  useDeleteTimeOff: () => ({ deleteTimeOff, isDeleting: false }),
}));

vi.mock('@/features/practitioners', () => ({
  useListPractitioners: () => ({
    practitioners: [
      { id: 'prac_1', name: 'Alex Stylist' },
      { id: 'prac_2', name: 'Sam Barber' },
    ],
  }),
}));

vi.mock('@/features/organization', () => ({
  useActiveOrganization: () => ({
    data: { id: 'org_1', timezone: 'Europe/Dublin' },
  }),
}));

import { TimeOffDialog } from './time-off-dialog';

describe('TimeOffDialog (form)', () => {
  beforeEach(() => {
    createTimeOff.mockReset();
    updateTimeOff.mockReset();
    deleteTimeOff.mockReset();
  });

  it('creates time off with the selected member, type and start/end intent', async () => {
    renderWithProviders(
      <TimeOffDialog
        open
        onOpenChange={() => {}}
        initial={{ practitionerId: 'prac_1', date: '2026-03-02' }}
      />
    );

    expect(
      screen.getByRole('heading', { name: /add time off/i })
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(createTimeOff).toHaveBeenCalledTimes(1));
    const intent = createTimeOff.mock.calls[0][0];
    expect(intent).toMatchObject({
      practitionerId: 'prac_1',
      type: 'annual_leave', // dialog default
      startDate: '2026-03-02',
      endDate: '2026-03-02',
      startTime: '09:00',
      endTime: '17:00',
      repeats: false, // "Repeats weekly" off
      approved: true,
      // The dialog forwards the ORG timezone, not the device one.
      timeZone: 'Europe/Dublin',
    });
    expect(updateTimeOff).not.toHaveBeenCalled();
  });

  it('blocks submit and shows a validation error when no member is chosen', async () => {
    renderWithProviders(<TimeOffDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Choose a team member')).toBeVisible();
    expect(createTimeOff).not.toHaveBeenCalled();
    expect(updateTimeOff).not.toHaveBeenCalled();
  });

  it('threads the id and edits via updateTimeOff in edit mode', async () => {
    renderWithProviders(
      <TimeOffDialog
        open
        onOpenChange={() => {}}
        timeOff={{
          id: 'to_existing',
          practitionerId: 'prac_2',
          type: 'sick_leave',
          startDate: '2026-03-02T09:00:00.000Z',
          endDate: '2026-03-02T17:00:00.000Z',
          allDay: false,
          rrule: null,
          recurrenceEndDate: null,
          description: 'flu',
          approved: true,
        }}
      />
    );

    expect(
      screen.getByRole('heading', { name: /edit time off/i })
    ).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateTimeOff).toHaveBeenCalledTimes(1));
    const intent = updateTimeOff.mock.calls[0][0];
    expect(intent).toMatchObject({
      id: 'to_existing',
      type: 'sick_leave',
      approved: true,
      timeZone: 'Europe/Dublin',
    });
    // On edit the member is not resubmitted (Select is disabled); id is threaded.
    expect(intent.id).toBe('to_existing');
    expect(createTimeOff).not.toHaveBeenCalled();
  });

  it('deletes via deleteTimeOff from the destructive action', () => {
    renderWithProviders(
      <TimeOffDialog
        open
        onOpenChange={() => {}}
        timeOff={{
          id: 'to_del',
          practitionerId: 'prac_1',
          type: 'annual_leave',
          startDate: '2026-03-02T09:00:00.000Z',
          endDate: '2026-03-02T17:00:00.000Z',
          allDay: false,
          rrule: null,
          recurrenceEndDate: null,
          description: null,
          approved: true,
        }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(deleteTimeOff).toHaveBeenCalledWith('to_del');
  });
});
