/**
 * Frontend mirrors of the Claire-guided onboarding API types.
 *
 * Source of truth: `apps/api/src/onboarding/onboarding.controller.ts` +
 * `packages/features/src/onboarding/`. Dates are ISO strings on the wire.
 * Slide keys mirror `packages/labels/src/onboarding.ts` (onboardingSlideLabels).
 */

// Website-analysis job polling reuses the shared api-client type (the
// onboarding analysis endpoint proxies the same job shape).
export type { AnalyzeWebsiteJobStatus } from '@borradh-workspace/api-client/types';

// ==================== ENUM MIRRORS ====================

/** Mirror of `onboardingSlideLabels` keys (packages/labels/src/onboarding.ts). */
export type OnboardingSlide =
  | 'website'
  | 'intro'
  | 'verify_email'
  | 'analysis'
  | 'content_source'
  | 'content_upload'
  | 'campaign_pitch'
  | 'service_price'
  | 'intro_offer'
  | 'ad_picker'
  | 'video_picker'
  | 'campaign_review'
  | 'meta_connect'
  | 'campaign_live'
  | 'test_chat'
  | 'content_approval'
  | 'mobile_app'
  | 'whatsapp';

export type OnboardingSessionStatus = 'active' | 'completed' | 'abandoned';

export type OnboardingContentSource = 'upload' | 'stock';

/** The two slides whose free text round-trips through Claire. */
export type ConversationalSlide = 'campaign_pitch' | 'intro_offer';

// ==================== CONVERSATION ====================

export interface OnboardingSlideOption {
  label: string;
  value: string;
}

/**
 * The structured slide Claire responds with on conversational slides —
 * a headline plus buttons and/or one input, never free-form prose.
 */
export interface OnboardingSlideResponse {
  headline: string;
  description?: string;
  options: OnboardingSlideOption[];
  input?: 'text' | 'price' | null;
}

/** One Claire ↔ user round-trip stored on the session. */
export interface OnboardingConversationTurn {
  slide: string;
  userText: string;
  response: OnboardingSlideResponse;
  at: string; // ISO timestamp
}

// ==================== STAGED CAMPAIGN ====================

export type OnboardingLaunchProgress =
  | 'not_started'
  | 'campaign_created'
  | 'lead_form_synced'
  | 'ads_created'
  | 'launched';

/** Which launch-orchestrator step failed (from the /launch error body). */
export type OnboardingLaunchStep =
  | 'create_campaign'
  | 'sync_lead_form'
  | 'create_ads'
  | 'launch_ads';

/** The campaign staged locally BEFORE Meta is connected. */
export interface OnboardingStagedCampaign {
  name: string;
  dailyBudgetCents: number;
  currency?: string;
  targeting?: {
    location?: string;
    latitude?: number;
    longitude?: number;
    distanceKm?: number;
  };
  leadFormId?: string;
  nurtureChannel?: 'messenger' | 'whatsapp';
  launchProgress?: OnboardingLaunchProgress;
}

// ==================== SESSION ====================

/** GET/PATCH /onboarding/session response (serialized onboarding_session row). */
export interface OnboardingSession {
  id: string;
  userId: string;
  organizationId: string | null;
  status: OnboardingSessionStatus;
  currentSlide: OnboardingSlide;
  answers: Record<string, unknown> | null;
  conversationTurns: OnboardingConversationTurn[] | null;
  websiteUrl: string | null;
  analysisJobId: string | null;
  analysisResult: Record<string, unknown> | null;
  contentSource: OnboardingContentSource | null;
  contentBatchId: string | null;
  selectedServiceId: string | null;
  servicePriceCents: number | null;
  offerId: string | null;
  adCandidateGraphicIds: string[] | null;
  selectedGraphicIds: string[] | null;
  videoCandidateIds: string[] | null;
  selectedVideoId: string | null;
  stagedCampaign: OnboardingStagedCampaign | null;
  metaCampaignId: string | null;
  launchedAt: string | null; // ISO timestamp
  createdAt: string;
  updatedAt: string;
}

// ==================== INPUTS ====================

/** PATCH /onboarding/session body. */
export interface UpdateOnboardingSessionInput {
  currentSlide?: OnboardingSlide;
  answer?: {
    slide: OnboardingSlide;
    value: unknown;
  };
}

/** POST /onboarding/website body. */
export interface StartOnboardingWebsiteInput {
  websiteUrl: string;
}

/** POST /onboarding/converse body. */
export interface ConverseOnboardingSlideInput {
  slide: ConversationalSlide;
  userText: string;
}

/** POST /onboarding/accept-offer body. */
export interface AcceptIntroOfferInput {
  /** Owner-adjusted intro price in cents. Omit to take the suggested price. */
  offerPriceCents?: number;
  notes?: string;
}

/** POST /onboarding/ad-candidates/:graphicId/regenerate body. */
export interface RegenerateAdCandidateInput {
  graphicId: string;
  /** The owner's change request ("make it brighter", "lead with the price"). */
  prompt: string;
}

/** POST /onboarding/stage-campaign body. */
export interface StageOnboardingCampaignInput {
  /** Optional owner-picked budget; defaults to the org's ad budget default. */
  dailyBudgetCents?: number;
}

// ==================== RESPONSES ====================

/** POST /onboarding/website response. */
export interface StartOnboardingWebsiteResponse {
  jobId: string;
}

/** POST /onboarding/apply-analysis response. */
export interface ApplyAnalysisResponse {
  organizationId: string;
  createdServiceIds: string[];
}

/** POST /onboarding/suggest-service response. */
export interface SuggestCampaignServiceResponse {
  serviceId: string;
  serviceName: string;
  /** Plain-language "because Y and Z" reasons for leading with this service. */
  reasons: string[];
  priceKnown: boolean;
  priceCents?: number;
}

/** GET /onboarding/offer-preview response. */
export interface OnboardingOfferPreview {
  serviceId: string;
  serviceName: string;
  advisable: boolean;
  advisoryReason?: string;
  needsPrice: boolean;
  offerPriceCents?: number;
  originalPriceCents?: number;
  offerName?: string;
}

/** POST /onboarding/converse response. */
export interface ConverseOnboardingSlideResponse {
  slide: ConversationalSlide;
  response: OnboardingSlideResponse;
  /** `true` when the AI round-trip failed and the safe retry slide was returned. */
  fallback: boolean;
}

/** POST /onboarding/accept-offer response. */
export interface AcceptIntroOfferResponse {
  offerId: string;
  offerPriceCents: number;
}

/** POST /onboarding/ad-candidates + …/regenerate responses. */
export interface GenerateAdCandidatesResponse {
  graphicIds: string[];
}

export interface RegenerateAdCandidateResponse {
  /** The REPLACEMENT graphic id (a fresh row is minted per regenerate). */
  graphicId: string;
}

/** POST /onboarding/video-candidates response. */
export interface GenerateVideoCandidatesResponse {
  videoIds: string[];
}

// ==================== CANDIDATES POLL ====================

export type AdCandidateStatus = 'draft' | 'rendering' | 'ready' | 'failed';

export type VideoCandidateStatus =
  | 'draft'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

/** Mirror of the database `GraphicOutput` jsonb shape (signed URLs on the wire). */
export interface OnboardingGraphicOutput {
  aspectRatioId: string;
  platform: string;
  width: number;
  height: number;
  url: string;
  format: 'png' | 'jpg' | 'webp';
  renderedAt: string;
  thumbnailUrl?: string;
  slideId?: string;
  slideOrder?: number;
  objectKey?: string;
  renderedBy?: 'client' | 'server';
  status?: 'success' | 'failed';
  error?: string;
}

export interface OnboardingAdCandidate {
  id: string;
  status: AdCandidateStatus;
  outputs?: OnboardingGraphicOutput[];
}

export interface OnboardingVideoCandidate {
  id: string;
  status: VideoCandidateStatus;
  previewUrl?: string;
}

/** GET /onboarding/candidates response. */
export interface OnboardingCandidatesResponse {
  adCandidates: OnboardingAdCandidate[];
  videoCandidates: OnboardingVideoCandidate[];
}

// ==================== LAUNCH ====================

/** POST /onboarding/launch success response. */
export interface LaunchOnboardingCampaignResponse {
  metaCampaignId: string;
  adIds: string[];
  launchProgress: 'launched';
  launchedAt: string; // ISO timestamp
}

/** POST /onboarding/launch error body ({ message, step, launchProgress }). */
export interface LaunchOnboardingCampaignErrorBody {
  step?: OnboardingLaunchStep;
  launchProgress?: OnboardingLaunchProgress;
}
