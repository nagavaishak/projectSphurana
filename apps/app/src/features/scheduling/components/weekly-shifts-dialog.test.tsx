import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * WeeklyShiftsDialog — sets a practitioner's standing weekly pattern. The dialog
 * holds the pattern in local state seeded from `initialPattern` on open, and Save
 * fires setWeeklyShifts({ practitionerId, days }) with only the enabled days. We
 * mock the feature hook and assert the exact payload; the per-day toggle seeds a
 * default 09:00–17:00 interval, so we can add a day without driving the
 * ShiftIntervalFields interval editor.
 */

const setWeeklyShifts = vi.fn();

vi.mock('../api', () => ({
  useSetWeeklyShifts: () => ({ setWeeklyShifts, isSaving: false }),
}));

import { WeeklyShiftsDialog } from './weekly-shifts-dialog';

describe('WeeklyShiftsDialog', () => {
  beforeEach(() => setWeeklyShifts.mockReset());

  it('pre-fills from initialPattern and saves it as { practitionerId, days }', async () => {
    renderWithProviders(
      <WeeklyShiftsDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac_1"
        practitionerName="Alex Stylist"
        initialPattern={{ 1: [{ startMinutes: 540, endMinutes: 1020 }] }}
      />
    );

    // Monday toggle reflects the seeded pattern (enabled).
    expect(screen.getByLabelText('Working on Monday')).toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setWeeklyShifts).toHaveBeenCalledTimes(1));
    expect(setWeeklyShifts).toHaveBeenCalledWith({
      practitionerId: 'prac_1',
      days: [
        {
          dayOfWeek: 1,
          intervals: [{ startMinutes: 540, endMinutes: 1020 }],
        },
      ],
    });
  });

  it('adds a day via its toggle (default 09:00–17:00) and includes it in the payload', async () => {
    renderWithProviders(
      <WeeklyShiftsDialog
        open
        onOpenChange={() => {}}
        practitionerId="prac_1"
        practitionerName="Alex Stylist"
        initialPattern={{}}
      />
    );

    // Turn Tuesday (dayOfWeek 2) on — seeds a 9*60..17*60 interval.
    fireEvent.click(screen.getByLabelText('Working on Tuesday'));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(setWeeklyShifts).toHaveBeenCalledTimes(1));
    expect(setWeeklyShifts).toHaveBeenCalledWith({
      practitionerId: 'prac_1',
      days: [
        {
          dayOfWeek: 2,
          intervals: [{ startMinutes: 540, endMinutes: 1020 }],
        },
      ],
    });
  });
});
