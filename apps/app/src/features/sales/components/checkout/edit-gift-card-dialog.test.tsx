import { renderWithProviders, screen } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

// jsdom lacks the Pointer Capture / scrollIntoView APIs that Radix Select's
// trigger calls when opened. Polyfill them so the team-member dropdown can be
// exercised in tests.
beforeAll(() => {
  const proto = window.HTMLElement.prototype;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => {};
  proto.releasePointerCapture ??= () => {};
  proto.scrollIntoView ??= () => {};
});

/**
 * EditGiftCardDialog — the Fresha "Edit gift card" form. Money-critical: the
 * card's FACE VALUE and the PRICE the client pays are separate. Apply must send
 * `unitPriceCents` = price and `giftCardFaceValueCents` = face value, both in
 * exact cents, plus the chosen expiry. A price above the face value (invalid
 * "discount") must gate Apply.
 *
 * Presentational (plain props); only onConfirm is spied.
 */

import { EditGiftCardDialog } from './edit-gift-card-dialog';

const baseProps = {
  open: true as const,
  onOpenChange: () => {},
  currency: 'eur',
  teamMembers: [],
};

describe('EditGiftCardDialog', () => {
  it('applies a preset with face value = price when undiscounted', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <EditGiftCardDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        initialValue={50}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      itemType: 'gift_card',
      name: 'Gift card',
      quantity: 1,
      unitPriceCents: 5000,
      giftCardFaceValueCents: 5000,
      giftCardExpiry: '1y',
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('sends the discounted price while issuing the full face value', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <EditGiftCardDialog
        {...baseProps}
        initialValue={50}
        onConfirm={onConfirm}
      />
    );

    const price = screen.getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '20');

    // The manual-discount hint appears once price < value.
    expect(screen.getByText(/manual discount applied/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        unitPriceCents: 2000,
        giftCardFaceValueCents: 5000,
      })
    );
  });

  it('gates Apply when the price exceeds the face value', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <EditGiftCardDialog
        {...baseProps}
        initialValue={50}
        onConfirm={onConfirm}
      />
    );

    const price = screen.getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '80');

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Reset restores the price to the face value', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <EditGiftCardDialog
        {...baseProps}
        initialValue={50}
        onConfirm={onConfirm}
      />
    );

    const price = screen.getByLabelText('Price');
    await user.clear(price);
    await user.type(price, '20');
    await user.click(screen.getByRole('button', { name: 'Reset' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        unitPriceCents: 5000,
        giftCardFaceValueCents: 5000,
      })
    );
  });

  it('gates Apply for a custom amount until a value is entered', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <EditGiftCardDialog
        {...baseProps}
        initialValue={null}
        onConfirm={onConfirm}
      />
    );

    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    await user.type(screen.getByLabelText('Gift card value'), '35');
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        unitPriceCents: 3500,
        giftCardFaceValueCents: 3500,
      })
    );
  });

  it('attributes the sale line to the selected team member', async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();

    renderWithProviders(
      <EditGiftCardDialog
        {...baseProps}
        initialValue={25}
        teamMembers={[{ id: 'prac-1', name: 'Daniel Cerasi' }]}
        onConfirm={onConfirm}
      />
    );

    await user.click(screen.getByLabelText('Team member'));
    await user.click(screen.getByRole('option', { name: 'Daniel Cerasi' }));
    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ practitionerId: 'prac-1' })
    );
  });
});
