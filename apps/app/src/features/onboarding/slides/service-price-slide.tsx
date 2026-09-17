import { useState } from 'react';

import { getCurrencySymbol } from '@/features/meta-campaigns/components/create-campaign-form/create-campaign-form.utils';

import { SlideInput, SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';
import type { CampaignPitchAnswer } from './campaign-pitch-slide';

export interface ServicePriceSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/** The answer recorded for this slide — read back by the intro-offer slide. */
export interface ServicePriceAnswer {
  servicePriceCents: number;
}

/** "180", "180.50" or "1,250" → cents; null when not a positive number. */
export const parsePriceToCents = (raw: string): number | null => {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
};

/** Derive a display currency from the analysed location country (pre-Meta). */
export const currencyForOnboardingSession = (
  session: OnboardingSession
): string => {
  const analysis = session.analysisResult as {
    locations?: { country?: string }[];
  } | null;
  const country = analysis?.locations?.[0]?.country?.toLowerCase();
  if (country === 'gb' || country === 'uk') return 'GBP';
  if (country === 'us') return 'USD';
  return 'EUR';
};

/**
 * Slide 6 — `service_price` (conditional: only when the analysis didn't find
 * a price). The entered price is stored in the session's `answers` jsonb via
 * `onAdvance` — the PATCH does NOT write the `servicePriceCents` column, so
 * the intro-offer slide reads it back from `answers.service_price` and
 * threads it into the accept-offer call as `offerPriceCents`.
 */
export function ServicePriceSlide({
  session,
  onAdvance,
}: ServicePriceSlideProps) {
  const [price, setPrice] = useState('');

  const pitch = session.answers?.campaign_pitch as
    | CampaignPitchAnswer
    | undefined;
  const serviceName = pitch?.serviceName ?? 'this service';
  const currencySymbol = getCurrencySymbol(
    currencyForOnboardingSession(session)
  );

  const cents = parsePriceToCents(price);

  const handleSubmit = () => {
    if (cents == null) return;
    const answer: ServicePriceAnswer = { servicePriceCents: cents };
    onAdvance('intro_offer', answer);
  };

  return (
    <SlideShell
      step={6}
      headline={`What do you charge for **${serviceName}**?`}
      description="Your regular price for one session — I'll build the intro offer around it."
      onSubmit={handleSubmit}
      submitDisabled={cents == null}
    >
      <SlideInput
        variant="price"
        value={price}
        onChange={setPrice}
        label={`Price for ${serviceName}`}
        placeholder="0.00"
        currencySymbol={currencySymbol}
        autoFocus
      />
    </SlideShell>
  );
}
