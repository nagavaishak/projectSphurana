import { fireEvent, renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { OnboardingAdCandidate, OnboardingSession } from '../types';

/**
 * AdPickerSlide — 2×2 grid of generated ad graphics; the owner must pick
 * EXACTLY two (PICK_COUNT) to continue. Validation: Continue stays disabled at
 * 0 or 1 selections, the selection caps at two (a third click is a no-op), and
 * on submit the chosen ids advance to `video_picker` under the answer payload.
 *
 * `useCandidates` (poll) and `useRegenerateAdCandidate` are mocked so the grid
 * renders deterministically ready cards with no network.
 */

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

let adCandidates: OnboardingAdCandidate[] = [];
const regenerateAd = vi.fn();

vi.mock('../api/index', () => ({
  useCandidates: () => ({
    adCandidates,
    videoCandidates: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRegenerateAdCandidate: () => ({ regenerateAd, isRegenerating: false }),
}));

import { AdPickerSlide } from './ad-picker-slide';

const readyCandidate = (id: string): OnboardingAdCandidate => ({
  id,
  status: 'ready',
  outputs: [
    {
      aspectRatioId: '1:1',
      platform: 'instagram',
      width: 1080,
      height: 1080,
      url: `https://cdn.example/${id}.png`,
      format: 'png',
      renderedAt: '2024-01-01T00:00:00.000Z',
      status: 'success',
    },
  ],
});

const session = { selectedGraphicIds: null } as unknown as OnboardingSession;

describe('AdPickerSlide', () => {
  const onAdvance = vi.fn();

  beforeEach(() => {
    onAdvance.mockReset();
    regenerateAd.mockReset();
    adCandidates = [
      readyCandidate('g1'),
      readyCandidate('g2'),
      readyCandidate('g3'),
    ];
  });

  it('keeps Continue disabled until exactly two ads are selected', () => {
    renderWithProviders(
      <AdPickerSlide session={session} onAdvance={onAdvance} />
    );

    const submit = screen.getByRole('button', { name: 'Continue' });
    const options = screen.getAllByRole('button', { pressed: false });
    expect(submit).toBeDisabled();

    fireEvent.click(options[0]);
    expect(submit).toBeDisabled(); // 1 selected

    fireEvent.click(options[1]);
    expect(submit).toBeEnabled(); // 2 selected
  });

  it('caps the selection at two and advances with the picked ids', () => {
    renderWithProviders(
      <AdPickerSlide session={session} onAdvance={onAdvance} />
    );

    const options = screen.getAllByRole('button', { pressed: false });
    expect(options).toHaveLength(3);

    fireEvent.click(options[0]); // g1
    fireEvent.click(options[1]); // g2
    fireEvent.click(options[2]); // g3 — no-op, cap reached

    // Only two remain pressed.
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onAdvance).toHaveBeenCalledWith('video_picker', {
      selectedGraphicIds: ['g1', 'g2'],
    });
  });
});
