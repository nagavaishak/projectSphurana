import { useState } from 'react';

import { useStartWebsiteAnalysis } from '../api/index';
import { SlideInput, SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface WebsiteSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/** Prepend https:// when the owner types a bare domain. */
const normalizeUrl = (raw: string): string => {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

/**
 * Slide 3 — `website`. Captures the website URL and kicks the background
 * brand analysis, then moves straight to the analysis slide. The email is
 * already verified by this point — the `verify_email` step runs right after
 * the intro, before this slide.
 */
export function WebsiteSlide({ session, onAdvance }: WebsiteSlideProps) {
  const [url, setUrl] = useState(session.websiteUrl ?? '');

  const { startAnalysis, isStarting } = useStartWebsiteAnalysis({
    onSuccess: () => onAdvance('analysis'),
  });

  const handleSubmit = () => {
    const websiteUrl = normalizeUrl(url);
    if (!websiteUrl || isStarting) return;
    startAnalysis({ websiteUrl });
  };

  return (
    <SlideShell
      step={2}
      headline="Share your **website** and I'll build your brand."
      description="I'll read it to pull out your services, colors, logo and locations — no forms to fill."
      skip={{
        label: "I don't have a website",
        onSkip: () => onAdvance('analysis'),
      }}
      onSubmit={handleSubmit}
      submitLabel={isStarting ? 'Starting…' : 'Continue'}
      submitDisabled={!url.trim() || isStarting}
    >
      <SlideInput
        variant="url"
        value={url}
        onChange={setUrl}
        label="Your website URL"
        placeholder="https://yourbusiness.com"
        autoFocus
      />
    </SlideShell>
  );
}
