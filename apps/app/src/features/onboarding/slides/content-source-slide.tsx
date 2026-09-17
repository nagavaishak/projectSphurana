import { useState } from 'react';

import { useStartContentBatch } from '../api';
import { SlideOptions, SlideShell } from '../components/index';
import type {
  OnboardingContentSource,
  OnboardingSession,
  OnboardingSlide,
} from '../types';

export interface ContentSourceSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/**
 * Slide 4 — `content_source`. Choose where the month-of-content pulls footage
 * from. "Stock" kicks the batch immediately and moves on; "upload" routes to
 * the dedicated upload slide (so the batch waits until the owner's real
 * footage is registered).
 */
export function ContentSourceSlide({
  session,
  onAdvance,
}: ContentSourceSlideProps) {
  const [choice, setChoice] = useState<OnboardingContentSource | null>(
    session.contentSource
  );
  const { startContentBatch } = useStartContentBatch();

  const handleSubmit = () => {
    if (!choice) return;
    if (choice === 'upload') {
      onAdvance('content_upload', { contentSource: choice });
      return;
    }
    // Stock: fire-and-forget generation now; the approval slide handles the
    // still-generating state.
    startContentBatch();
    onAdvance('campaign_pitch', { contentSource: choice });
  };

  return (
    <SlideShell
      step={4}
      headline="Using the marketing strategy I just made, I'm now going to create your **month's content**."
      description="Posts, captions and videos for the next month — scheduled and ready for your approval."
      onSubmit={handleSubmit}
      submitDisabled={!choice}
    >
      <SlideOptions
        value={choice}
        onSelect={(value) => setChoice(value as OnboardingContentSource)}
        options={[
          {
            value: 'upload',
            label: 'Upload content now',
            description: 'Use your own photos and videos in what I create.',
          },
          {
            value: 'stock',
            label: 'Use stock images and videos for now',
            description: 'Start with curated footage — swap in your own later.',
          },
        ]}
      />
    </SlideShell>
  );
}
