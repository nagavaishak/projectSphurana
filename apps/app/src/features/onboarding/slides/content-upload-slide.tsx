import { useState } from 'react';

import { useStartContentBatch } from '../api';
import { OnboardingUploadPanel, SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface ContentUploadSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/**
 * Slide `content_upload` — reached only when the owner chose "upload content".
 * A large dropzone fills the slide; uploaded files are registered as org
 * assets so the month-of-content generation (kicked on Continue) uses the
 * owner's real footage. Continue holds while uploads are in flight.
 */
export function ContentUploadSlide({ onAdvance }: ContentUploadSlideProps) {
  const [uploading, setUploading] = useState(false);
  const [count, setCount] = useState(0);
  const { startContentBatch } = useStartContentBatch();

  const handleSubmit = () => {
    if (uploading) return;
    startContentBatch();
    onAdvance('campaign_pitch');
  };

  return (
    <SlideShell
      step={5}
      headline="Drop in your **photos and videos** and I'll build your content around them."
      description="Add as many as you like — I'll pick the best moments. You can skip and add more later."
      onSubmit={handleSubmit}
      submitLabel={
        uploading ? 'Uploading…' : count > 0 ? 'Continue' : 'Skip for now'
      }
      submitDisabled={uploading}
    >
      <OnboardingUploadPanel
        onUploadingChange={setUploading}
        onCountChange={setCount}
        dropzoneClassName="min-h-64"
      />
    </SlideShell>
  );
}
