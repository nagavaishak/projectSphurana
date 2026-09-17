import { createFileRoute } from '@tanstack/react-router';
import { useCallback } from 'react';

import {
  useOnboardingSession,
  useUpdateOnboardingSession,
} from '@/features/onboarding/api';
import { SlideTransition } from '@/features/onboarding/components';
import {
  AdPickerSlide,
  AnalysisSlide,
  CampaignLiveSlide,
  CampaignPitchSlide,
  CampaignReviewSlide,
  ContentApprovalSlide,
  ContentSourceSlide,
  ContentUploadSlide,
  IntroOfferSlide,
  IntroSlide,
  MetaConnectSlide,
  MobileAppSlide,
  ServicePriceSlide,
  TestChatSlide,
  VerifyEmailSlide,
  VideoPickerSlide,
  WebsiteSlide,
  WhatsappSlide,
} from '@/features/onboarding/slides';
import type {
  OnboardingSession,
  OnboardingSlide,
} from '@/features/onboarding/types';
import { useSession } from '@/lib/session';

export const Route = createFileRoute('/welcome/')({
  component: WelcomePage,
});

interface SlideComponentProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

const SLIDES: Record<
  OnboardingSlide,
  (props: SlideComponentProps) => React.ReactNode
> = {
  website: WebsiteSlide,
  intro: IntroSlide,
  verify_email: VerifyEmailSlide,
  analysis: AnalysisSlide,
  content_source: ContentSourceSlide,
  content_upload: ContentUploadSlide,
  campaign_pitch: CampaignPitchSlide,
  service_price: ServicePriceSlide,
  intro_offer: IntroOfferSlide,
  ad_picker: AdPickerSlide,
  video_picker: VideoPickerSlide,
  campaign_review: CampaignReviewSlide,
  meta_connect: MetaConnectSlide,
  campaign_live: CampaignLiveSlide,
  test_chat: TestChatSlide,
  content_approval: ContentApprovalSlide,
  mobile_app: MobileAppSlide,
  whatsapp: WhatsappSlide,
};

/**
 * Placeholder for a user who never interacted with the flow — GET /session is
 * a non-creating peek, so before the first action there is no row. The
 * website slide's own mutations create the real session server-side.
 */
const emptySession = (): OnboardingSession =>
  ({
    id: '',
    userId: '',
    organizationId: null,
    status: 'active',
    currentSlide: 'intro',
    answers: null,
    conversationTurns: null,
    websiteUrl: null,
    analysisJobId: null,
    analysisResult: null,
    contentSource: null,
    contentBatchId: null,
    selectedServiceId: null,
    servicePriceCents: null,
    offerId: null,
    adCandidateGraphicIds: null,
    selectedGraphicIds: null,
    videoCandidateIds: null,
    selectedVideoId: null,
    stagedCampaign: null,
    metaCampaignId: null,
    launchedAt: null,
    createdAt: '',
    updatedAt: '',
  }) as OnboardingSession;

function WelcomePage() {
  const { session, isLoading } = useOnboardingSession();
  const { updateSession } = useUpdateOnboardingSession();
  const authSession = useSession();

  const active = session ?? emptySession();

  // Verification is the second slide (right after the intro), so an unverified
  // user should only ever be on `intro` or `verify_email`. If a resumed session
  // is parked further along but the email still isn't verified, force the
  // verify step — otherwise they'd sail into slides that need a verified email
  // (the analysis slide creates the org, which the backend AuthGuard blocks).
  const emailVerified = Boolean(authSession.data?.user?.emailVerified);
  const needsVerify =
    !emailVerified &&
    active.currentSlide !== 'intro' &&
    active.currentSlide !== 'verify_email';
  const currentSlide = needsVerify ? 'verify_email' : active.currentSlide;

  const onAdvance = useCallback(
    (next: OnboardingSlide, answer?: unknown) => {
      // PATCH upserts server-side, so this also works from the placeholder
      // (e.g. skipping the website slide before any session exists). The
      // answer is recorded under the CURRENT slide's key; the service lifts
      // picker selections / price / content source into their columns.
      updateSession({
        currentSlide: next,
        ...(answer !== undefined
          ? { answer: { slide: currentSlide, value: answer } }
          : {}),
      });
    },
    [updateSession, currentSlide]
  );

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground" />
      </div>
    );
  }

  const Slide = SLIDES[currentSlide] ?? WebsiteSlide;

  return (
    <SlideTransition slideKey={currentSlide}>
      <Slide session={active} onAdvance={onAdvance} />
    </SlideTransition>
  );
}
