import { Rocket } from 'lucide-react';

import { SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface CampaignLiveSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/**
 * Slide 12 — `campaign_live`. Pure celebration: the launch orchestrator
 * finished, ads are ACTIVE and spending. Shimmer border for the moment.
 */
export function CampaignLiveSlide({
  session,
  onAdvance,
}: CampaignLiveSlideProps) {
  return (
    <SlideShell
      step={12}
      headline="Your campaign is **live** 🚀 Congratulations!"
      description="Your ads are running and leads will start coming in. I'll message every lead the moment they fill in your form."
      shimmerBorder
      onSubmit={() => onAdvance('test_chat')}
    >
      <div className="bg-primary/10 text-primary inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium">
        <Rocket className="size-4" />
        {session.stagedCampaign?.name ?? 'Your first campaign'} is live
      </div>
    </SlideShell>
  );
}
