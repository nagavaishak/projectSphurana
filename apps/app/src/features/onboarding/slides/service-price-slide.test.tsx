import { fireEvent, renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../types';
import { ServicePriceSlide, parsePriceToCents } from './service-price-slide';

/**
 * ServicePriceSlide — the conditional price-capture slide (only shown when the
 * website analysis couldn't find a price). Validation lives in
 * `parsePriceToCents` + the `submitDisabled` gate: a non-positive / non-numeric
 * entry keeps Continue disabled, a valid entry advances to `intro_offer` with
 * the price in CENTS recorded under the slide's answer.
 *
 * No API hooks are used by this slide (currency is derived purely from the
 * analysis result), so only the `onAdvance` callback is stubbed.
 */

// motion/react + slide shell touch these in jsdom.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const baseSession = {
  answers: null,
  analysisResult: null,
} as unknown as OnboardingSession;

describe('parsePriceToCents', () => {
  it('rejects zero, negative and non-numeric input', () => {
    expect(parsePriceToCents('0')).toBeNull();
    expect(parsePriceToCents('-5')).toBeNull();
    expect(parsePriceToCents('abc')).toBeNull();
    expect(parsePriceToCents('')).toBeNull();
    expect(parsePriceToCents('   ')).toBeNull();
  });

  it('converts positive decimals and thousands separators to cents', () => {
    expect(parsePriceToCents('180')).toBe(18000);
    expect(parsePriceToCents('180.50')).toBe(18050);
    expect(parsePriceToCents('1,250')).toBe(125000);
  });
});

describe('ServicePriceSlide', () => {
  const onAdvance = vi.fn();

  beforeEach(() => onAdvance.mockReset());

  it('keeps Continue disabled until a valid price is entered', () => {
    renderWithProviders(
      <ServicePriceSlide session={baseSession} onAdvance={onAdvance} />
    );

    const submit = screen.getByRole('button', { name: 'Continue' });
    expect(submit).toBeDisabled();

    // A valid price enables the button.
    fireEvent.change(screen.getByLabelText('Price for this service'), {
      target: { value: '180' },
    });
    expect(submit).toBeEnabled();
  });

  it('does not advance while the price is empty/invalid', () => {
    renderWithProviders(
      <ServicePriceSlide session={baseSession} onAdvance={onAdvance} />
    );

    // The price input strips non-numeric characters, so letters land as empty.
    fireEvent.change(screen.getByLabelText('Price for this service'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onAdvance).not.toHaveBeenCalled();
  });

  it('advances to intro_offer with the price in cents', () => {
    renderWithProviders(
      <ServicePriceSlide session={baseSession} onAdvance={onAdvance} />
    );

    fireEvent.change(screen.getByLabelText('Price for this service'), {
      target: { value: '180' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(onAdvance).toHaveBeenCalledWith('intro_offer', {
      servicePriceCents: 18000,
    });
  });
});
