import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

/**
 * AmountKeypadDialog — the numeric keypad behind cash / gift-card tender.
 * This handles money, so every assertion pins the EXACT integer cents the
 * dialog emits on confirm: keypad presses build a decimal string that is
 * converted to cents (toCents = Math.round(amount * 100)) before onSubmit.
 *
 * Presentational component (plain props, no hooks that hit the API), so no
 * mocks are needed beyond spying on the callback.
 */

import { AmountKeypadDialog } from './amount-keypad-dialog';

function press(user: ReturnType<typeof userEvent.setup>, label: string) {
  return user.click(screen.getByRole('button', { name: label }));
}

describe('AmountKeypadDialog', () => {
  it('builds whole-euro cents from keypad digits and confirms them', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <AmountKeypadDialog
        open
        onOpenChange={() => {}}
        title="Add cash amount"
        currency="eur"
        remaining={0}
        onSubmit={onSubmit}
      />
    );

    // "25" → 25.00 → 2500 cents.
    await press(user, '2');
    await press(user, '5');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(2500);
  });

  it('preserves two-decimal precision (25.50 → 2550 cents, not 2549/2551)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <AmountKeypadDialog
        open
        onOpenChange={() => {}}
        title="Add cash amount"
        currency="eur"
        remaining={0}
        onSubmit={onSubmit}
      />
    );

    await press(user, '2');
    await press(user, '5');
    await press(user, '.');
    await press(user, '5');
    await press(user, '0');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onSubmit).toHaveBeenCalledWith(2550);
  });

  it('seeds the amount from the outstanding balance and confirms it unedited', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    // remaining is already in cents — confirming without touching the keypad
    // must emit exactly that value.
    renderWithProviders(
      <AmountKeypadDialog
        open
        onOpenChange={() => {}}
        title="Add cash amount"
        currency="eur"
        remaining={5000}
        onSubmit={onSubmit}
      />
    );

    await user.click(await screen.findByRole('button', { name: 'Add' }));
    expect(onSubmit).toHaveBeenCalledWith(5000);
  });

  it('disables confirm and is a no-op for a zero / empty amount', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <AmountKeypadDialog
        open
        onOpenChange={() => {}}
        title="Add cash amount"
        currency="eur"
        remaining={0}
        onSubmit={onSubmit}
      />
    );

    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    await user.click(add);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('applies chargeFor to cap the charged cents (gift-card style)', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();

    // Typed 25.00 (2500 cents) but the card only has 10.00 (1000 cents) left.
    renderWithProviders(
      <AmountKeypadDialog
        open
        onOpenChange={() => {}}
        title="Redeem gift card"
        currency="eur"
        remaining={0}
        chargeFor={(cents) => Math.min(cents, 1000)}
        onSubmit={onSubmit}
      />
    );

    await press(user, '2');
    await press(user, '5');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    // The capped charge is emitted, not the typed amount.
    expect(onSubmit).toHaveBeenCalledWith(1000);
  });

  it('respects a custom submit label', async () => {
    renderWithProviders(
      <AmountKeypadDialog
        open
        onOpenChange={() => {}}
        title="Add cash amount"
        currency="eur"
        remaining={1500}
        submitLabel="Charge"
        onSubmit={() => {}}
      />
    );

    expect(
      await screen.findByRole('button', { name: 'Charge' })
    ).toBeInTheDocument();
  });
});
