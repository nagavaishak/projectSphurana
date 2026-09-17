import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { appAuthenticated } from '../rls-policy.js';
import { offer } from './offer.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels (pure TypeScript)
import {
  onboardingContentSourceLabels,
  onboardingContentSourceValues,
  onboardingSessionStatusLabels,
  onboardingSessionStatusValues,
  onboardingSlideLabels,
  onboardingSlideValues,
} from '@borradh-workspace/labels';

// Re-export labels and values for consumers
export {
  onboardingSlideLabels,
  onboardingSlideValues,
  onboardingSessionStatusLabels,
  onboardingSessionStatusValues,
  onboardingContentSourceLabels,
  onboardingContentSourceValues,
};
export type {
  OnboardingSlide,
  OnboardingSessionStatus,
  OnboardingContentSource,
} from '@borradh-workspace/labels';

// Database enums
export const onboardingSessionStatusEnum = pgEnum(
  'onboarding_session_status',
  onboardingSessionStatusValues
);

export const onboardingContentSourceEnum = pgEnum(
  'onboarding_content_source',
  onboardingContentSourceValues
);

// ==================== TYPE INTERFACES ====================

/**
 * One Claire ↔ user round-trip on a conversational slide (campaign_pitch /
 * intro_offer). Every Claire response is itself a rendered slide with
 * structured options — never free-form prose.
 */
export interface OnboardingConversationTurn {
  slide: string;
  userText: string;
  response: {
    headline: string;
    description?: string;
    options: Array<{ label: string; value: string }>;
    input?: 'text' | 'price' | null;
  };
  at: string; // ISO timestamp
}

/**
 * The campaign staged locally BEFORE Meta is connected. `createCampaign` is an
 * online Meta call, so everything is prepared here and the launch orchestrator
 * replays it after the FLfB popup succeeds.
 */
export interface OnboardingStagedCampaign {
  name: string;
  dailyBudgetCents: number;
  currency?: string;
  /**
   * What the review slide shows and the launcher replays.
   *
   * `locationId` is the branch; its geocoded coordinates are resolved at launch
   * from the live row rather than snapshotted here, so a staged campaign that
   * sits for a week and an address corrected in the meantime cannot disagree.
   * `location` is a display label only.
   *
   * `latitude` / `longitude` are LEGACY: sessions staged before campaigns took
   * a branch still carry them, and the review slide still reads the label. The
   * launcher no longer sends coordinates to Meta.
   */
  targeting?: {
    locationId?: string;
    location?: string;
    /** @deprecated snapshotted coordinates; the branch is the source now. */
    latitude?: number;
    /** @deprecated snapshotted coordinates; the branch is the source now. */
    longitude?: number;
    distanceKm?: number;
  };
  leadFormId?: string; // local draft leadForm row (syncToMeta deferred)
  nurtureChannel?: 'messenger' | 'whatsapp';
  /**
   * Launch-orchestrator progress marker so a crash/retry resumes instead of
   * double-launching: which step last completed.
   */
  launchProgress?:
    | 'not_started'
    | 'campaign_created'
    | 'lead_form_synced'
    | 'ads_created'
    | 'launched';
}

// ==================== TABLE ====================

/**
 * Claire-guided onboarding session — one per USER (created at the website
 * slide, BEFORE email verification and before any organization exists).
 * Holds the resume pointer, every slide answer, background-job references
 * and the staged campaign, so closing the tab resumes exactly where the
 * user left off on next login.
 */
export const onboardingSession = pgTable(
  'onboarding_session',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // Null until apply-analysis-to-organization creates the org (post-verify)
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),

    status: onboardingSessionStatusEnum('status').notNull().default('active'),
    currentSlide: text('current_slide')
      .$type<keyof typeof onboardingSlideLabels>()
      .notNull()
      .default('intro'),

    // Slide answers keyed by slide key (buttons picked, values entered)
    answers: jsonb('answers').$type<Record<string, unknown>>(),
    // Claire round-trips on conversational slides
    conversationTurns:
      jsonb('conversation_turns').$type<OnboardingConversationTurn[]>(),

    // Website analysis (runs while the user verifies their email)
    websiteUrl: text('website_url'),
    analysisJobId: text('analysis_job_id'),
    // Snapshot of the analysis result — applied to the organization once
    // created; kept so the analysis slide can re-render on resume
    analysisResult: jsonb('analysis_result').$type<Record<string, unknown>>(),

    // Month-of-content generation
    contentSource: onboardingContentSourceEnum('content_source'),
    contentBatchId: text('content_batch_id'),

    // Campaign staging
    selectedServiceId: text('selected_service_id'),
    servicePriceCents: integer('service_price_cents'),
    // The accepted intro offer is a REAL row in the offer table (created via
    // the existing createOffer service once the user accepts the slide) — the
    // session only references it. Negotiation back-and-forth lives in
    // conversationTurns.
    offerId: text('offer_id').references(() => offer.id, {
      onDelete: 'set null',
    }),
    adCandidateGraphicIds: jsonb('ad_candidate_graphic_ids').$type<string[]>(),
    selectedGraphicIds: jsonb('selected_graphic_ids').$type<string[]>(),
    videoCandidateIds: jsonb('video_candidate_ids').$type<string[]>(),
    selectedVideoId: text('selected_video_id'),
    stagedCampaign: jsonb('staged_campaign').$type<OnboardingStagedCampaign>(),

    // Launch outcome
    metaCampaignId: text('meta_campaign_id'),
    launchedAt: timestamp('launched_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One session per user — resume, never duplicate
    uniqueIndex('uniq_onboarding_session_user').on(table.userId),
    index('idx_onboarding_session_org_id').on(table.organizationId),
  ]
);

/**
 * RLS: USER-scoped, not org-scoped — the row exists before any organization
 * does (pre-email-verification website slide). `app.current_user_id` is set
 * by the RLS context for every authenticated request.
 */
export const onboardingSessionRlsPolicy = pgPolicy('user_isolation', {
  as: 'permissive',
  for: 'all',
  to: [appAuthenticated],
  using: sql`user_id = current_setting('app.current_user_id', true)`,
  withCheck: sql`user_id = current_setting('app.current_user_id', true)`,
}).link(onboardingSession);

// ==================== RELATIONS ====================

export const onboardingSessionRelations = relations(
  onboardingSession,
  ({ one }) => ({
    user: one(user, {
      fields: [onboardingSession.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [onboardingSession.organizationId],
      references: [organization.id],
    }),
    offer: one(offer, {
      fields: [onboardingSession.offerId],
      references: [offer.id],
    }),
  })
);

// ==================== TYPE EXPORTS ====================

export type OnboardingSession = typeof onboardingSession.$inferSelect;
export type NewOnboardingSession = typeof onboardingSession.$inferInsert;
