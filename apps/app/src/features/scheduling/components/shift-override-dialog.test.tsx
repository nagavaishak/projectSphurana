import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ShiftOverrideDialog — edits a single day's shifts for one practitioner. Save
 * writes a date override via setShiftOverride({ practitionerId, date, isOff,
 * intervals }); the delete-day action either drops an existing override
 * (deleteShiftOverride) or writes an "off" override when the day comes from the
 * weekly pattern. We mock both hooks and assert the payloads. The form seeds a
 * default 10:00–19:00 interval, so the create-override payload is asserted
 * without driving the TimeSelect interval editor.
 */

const setShiftOverride = vi.fn();
const deleteShiftOverride = vi.fn();

vi.mock('../api', () => ({
  useSetShiftOverride: () => ({ setShiftOverride, isSaving: false }),
  useDeleteShiftOverride: () => ({ deleteShiftOverride, isDeleting: false }),
}));

import { ShiftOverrideDialog } from './shift-override-dialog';

describe('ShiftOverrideDialog', () => {
  beforeEach(() => {
    setShiftOverride.mockReset();
    deleteShiftOverride.mockReset();
  });

  it('saves a date override with the seeded default interval', async () => {
    renderWithProviders(
      <ShiftOverrideDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac_1"
        practitionerName="Alex Stylist"
        date="2026-03-02"
        resolvedDay={null}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setShiftOverride).toHaveBeenCalledTimes(1));
    expect(setShiftOverride).toHaveBeenCalledWith({
      practitionerId: 'prac_1',
      date: '2026-03-02',
      isOff: false,
      // DEFAULT_INTERVAL = 10:00 (600) .. 19:00 (1140)
      intervals: [{ startMinutes: 600, endMinutes: 1140 }],
    });
  });

  it('saves an "off" override when all shifts are removed', async () => {
    renderWithProviders(
      <ShiftOverrideDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac_1"
        practitionerName="Alex Stylist"
        date="2026-03-02"
        resolvedDay={null}
      />
    );

    // Remove the single seeded interval → "Not working this day."
    fireEvent.click(screen.getByRole('button', { name: 'Remove shift' }));
    expect(screen.getByText('Not working this day.')).toBeVisible();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setShiftOverride).toHaveBeenCalledTimes(1));
    expect(setShiftOverride).toHaveBeenCalledWith({
      practitionerId: 'prac_1',
      date: '2026-03-02',
      isOff: true,
      intervals: [],
    });
  });

  it('mark-day-off deletes the override when the day already has one', () => {
    renderWithProviders(
      <ShiftOverrideDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac_1"
        practitionerName="Alex Stylist"
        date="2026-03-02"
        resolvedDay={{
          source: 'override',
          isOff: false,
          intervals: [{ startMinutes: 540, endMinutes: 1020 }],
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: "Delete this day's shifts" })
    );

    expect(deleteShiftOverride).toHaveBeenCalledWith({
      practitionerId: 'prac_1',
      date: '2026-03-02',
    });
    expect(setShiftOverride).not.toHaveBeenCalled();
  });

  it('mark-day-off writes an "off" override when the day comes from the weekly pattern', () => {
    renderWithProviders(
      <ShiftOverrideDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac_1"
        practitionerName="Alex Stylist"
        date="2026-03-02"
        resolvedDay={{
          source: 'weekly',
          isOff: false,
          intervals: [{ startMinutes: 540, endMinutes: 1020 }],
        }}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: "Delete this day's shifts" })
    );

    expect(setShiftOverride).toHaveBeenCalledWith({
      practitionerId: 'prac_1',
      date: '2026-03-02',
      isOff: true,
      intervals: [],
    });
    expect(deleteShiftOverride).not.toHaveBeenCalled();
  });
});
