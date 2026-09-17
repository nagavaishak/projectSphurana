import { fireEvent, renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingSession } from '../types';

/**
 * WebsiteSlide — captures the website URL and kicks the background analysis.
 * Validation: Continue is disabled until a non-empty URL is typed; on submit
 * the value is normalized (bare domains get an `https://` prefix) before it is
 * handed to `startAnalysis`, which on success advances to the analysis slide.
 *
 * `useStartWebsiteAnalysis` is mocked so we (a) capture the exact payload and
 * (b) drive its `onSuccess` to prove the advance wiring — no network.
 */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

const startAnalysis = vi.fn();
let startOptions: { onSuccess?: () => void } | undefined;

vi.mock('../api/index', () => ({
  useStartWebsiteAnalysis: (opts?: { onSuccess?: () => void }) => {
    startOptions = opts;
    return { startAnalysis, isStarting: false };
  },
}));

import { WebsiteSlide } from './website-slide';

const session = { websiteUrl: null } as unknown as OnboardingSession;

describe('WebsiteSlide', () => {
  const onAdvance = vi.fn();

  beforeEach(() => {
    onAdvance.mockReset();
    startAnalysis.mockReset();
    startOptions = undefined;
  });

  it('disables Continue until a non-empty URL is entered', () => {
    renderWithProviders(
      <WebsiteSlide session={session} onAdvance={onAdvance} />
    );

    const submit = screen.getByRole('button', { name: 'Continue' });
    expect(submit).toBeDisabled();

    // Whitespace-only is still empty.
    fireEvent.change(screen.getByLabelText('Your website URL'), {
      target: { value: '   ' },
    });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Your website URL'), {
      target: { value: 'yourbusiness.com' },
    });
    expect(submit).toBeEnabled();
  });

  it('normalizes a bare domain to https:// before starting analysis', () => {
    renderWithProviders(
      <WebsiteSlide session={session} onAdvance={onAdvance} />
    );

    fireEvent.change(screen.getByLabelText('Your website URL'), {
      target: { value: 'yourbusiness.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(startAnalysis).toHaveBeenCalledWith({
      websiteUrl: 'https://yourbusiness.com',
    });
  });

  it('preserves an already-qualified URL and advances on success', () => {
    renderWithProviders(
      <WebsiteSlide session={session} onAdvance={onAdvance} />
    );

    fireEvent.change(screen.getByLabelText('Your website URL'), {
      target: { value: 'http://already.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(startAnalysis).toHaveBeenCalledWith({
      websiteUrl: 'http://already.example',
    });

    // Firing the mutation's success callback advances to the analysis slide.
    startOptions?.onSuccess?.();
    expect(onAdvance).toHaveBeenCalledWith('analysis');
  });

  it('lets the owner skip straight to analysis with no website', () => {
    renderWithProviders(
      <WebsiteSlide session={session} onAdvance={onAdvance} />
    );

    fireEvent.click(
      screen.getByRole('button', { name: "I don't have a website" })
    );

    expect(onAdvance).toHaveBeenCalledWith('analysis');
    expect(startAnalysis).not.toHaveBeenCalled();
  });
});
