import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BlockedTimeTypeDialog — create/edit a reusable blocked-time TYPE (Settings →
 * Blocked time types), distinct from the already-tested BlockedTimeDialog
 * instance form. react-hook-form + zod; we mock the create/update feature hooks
 * and assert the typed INTENT the component passes (name + durationMinutes +
 * `paid` radio), the id-threaded edit intent, and required-field validation
 * gating. The radio → boolean coercion now lives in the mutation hook's payload
 * builder (see create-blocked-time-type.payload.test.ts). Duration and
 * compensation use their form defaults (60 / unpaid), so the Radix Selects are
 * not driven.
 */

const createBlockedTimeType = vi.fn();
const updateBlockedTimeType = vi.fn();

vi.mock('../api', () => ({
  useCreateBlockedTimeType: () => ({
    createBlockedTimeType,
    isCreating: false,
  }),
  useUpdateBlockedTimeType: () => ({
    updateBlockedTimeType,
    isUpdating: false,
  }),
}));

import { BlockedTimeTypeDialog } from './blocked-time-type-dialog';

describe('BlockedTimeTypeDialog', () => {
  beforeEach(() => {
    createBlockedTimeType.mockReset();
    updateBlockedTimeType.mockReset();
  });

  it('creates a type with the default duration and unpaid compensation', async () => {
    renderWithProviders(<BlockedTimeTypeDialog open onOpenChange={() => {}} />);

    expect(
      screen.getByRole('heading', { name: /new blocked time type/i })
    ).toBeVisible();

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Lunch' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(createBlockedTimeType).toHaveBeenCalledTimes(1));
    expect(createBlockedTimeType).toHaveBeenCalledWith({
      name: 'Lunch',
      durationMinutes: 60,
      paid: 'unpaid',
    });
    expect(updateBlockedTimeType).not.toHaveBeenCalled();
  });

  it('blocks submit and shows an error when name is empty', async () => {
    renderWithProviders(<BlockedTimeTypeDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    expect(await screen.findByText('Name is required')).toBeVisible();
    expect(createBlockedTimeType).not.toHaveBeenCalled();
  });

  it('prefills and updates with the id threaded in edit mode', async () => {
    renderWithProviders(
      <BlockedTimeTypeDialog
        open
        onOpenChange={() => {}}
        blockedTimeType={{
          id: 'btt_1',
          name: 'Training',
          durationMinutes: 90,
          paid: true,
        }}
      />
    );

    expect(
      screen.getByRole('heading', { name: /edit blocked time type/i })
    ).toBeVisible();
    const name = screen.getByLabelText('Name') as HTMLInputElement;
    expect(name.value).toBe('Training');

    fireEvent.change(name, { target: { value: 'Team training' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateBlockedTimeType).toHaveBeenCalledTimes(1));
    expect(updateBlockedTimeType).toHaveBeenCalledWith({
      id: 'btt_1',
      name: 'Team training',
      durationMinutes: 90,
      paid: 'paid',
    });
    expect(createBlockedTimeType).not.toHaveBeenCalled();
  });
});
