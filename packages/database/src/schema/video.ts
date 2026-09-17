import { relations } from 'drizzle-orm';
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { offer } from './offer.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';
import { user } from './user.js';

// Import labels from enums (pure TypeScript)
import {
  videoProcessingStageLabels,
  videoProcessingStageValues,
  videoStatusLabels,
  videoStatusValues,
  videoUsageTypeLabels,
  videoUsageTypeValues,
} from '@borradh-workspace/labels';
import type {
  RenderDoc,
  SynthesisOverrides,
} from '@borradh-workspace/video-templates';

// Re-export labels and types for consumers
export {
  videoStatusLabels,
  videoStatusValues,
  videoProcessingStageLabels,
  videoProcessingStageValues,
  videoUsageTypeLabels,
  videoUsageTypeValues,
};
export type {
  VideoStatus,
  VideoProcessingStage,
  VideoUsageType,
} from '@borradh-workspace/labels';

// Database enums
export const videoStatusEnum = pgEnum('video_status', videoStatusValues);
export const videoProcessingStageEnum = pgEnum(
  'video_processing_stage',
  videoProcessingStageValues
);
export const videoUsageTypeEnum = pgEnum(
  'video_usage_type',
  videoUsageTypeValues
);

/**
 * Clip type for slot-based video templates
 * - before: Shows before transformation (displayed first)
 * - after: Shows after transformation (displayed last)
 * - bRoll: General b-roll footage (displayed in middle)
 */
export type ClipType = 'before' | 'after' | 'bRoll';

/**
 * B-roll clip configuration for the video timeline
 * Simple and flexible - works with any template type
 */
export interface BRollClipConfig {
  /** Asset ID from the assets table */
  assetId: string;
  /** S3 presigned URL for the clip (resolved from assetId during rendering) */
  url?: string;
  /** Display order in the timeline */
  order: number;
  /** Clip type for template-specific ordering (optional for backwards compat) */
  clipType?: ClipType;
}

/**
 * Caption styling configuration
 */
export interface CaptionConfig {
  enabled: boolean;
  position: 'top' | 'center' | 'bottom';
  fontFamily: string;
  fontSize: number;
  textColor: string;
  highlightColor: string;
  backgroundColor: string;
  showBackground: boolean;
}

/**
 * Outro/branding overlay configuration
 */
export interface OutroOverlayConfig {
  /** Organization logo URL */
  logoUrl?: string;
  /** Business name to display */
  businessName: string;
  /** Call-to-action text */
  ctaText: string;
  /** Background opacity (0-1, for transparent overlay) */
  backgroundOpacity: number;
  /** Background color */
  backgroundColor: string;
  /** Text color */
  textColor: string;
  /** Duration in seconds */
  durationSec: number;
  /** Outro layout style (overrides org default when set) */
  outroStyle?: 'offer' | 'location' | 'tagline';
}

/**
 * Picture-in-Picture overlay configuration for before/after thumbnails
 */
export interface PipOverlayConfig {
  /** URL of the image to display */
  imageUrl: string;
  /** Label text (e.g., "BEFORE", "AFTER") */
  label?: string;
  /** Position on screen */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Seconds after video start when overlay appears */
  startSec: number;
  /** Duration of overlay in seconds */
  durationSec: number;
  /** Size as percentage of viewport width (default: 20) */
  sizePercent?: number;
  /** Optional SFX URL */
  soundEffectUrl?: string;
}

/**
 * Draft config stored as JSON - contains video creation settings
 * Flexible design that works with any template type:
 * - Before/After transformations
 * - Client testimonials
 * - Tips & tutorials
 * - Behind the scenes
 * - Product demos
 */
export interface VideoDraftConfig {
  // User-edited script text (synced to mobile teleprompter)
  scriptText?: string;

  // Structured script roles from v2 synthesis (hook/body/cta + optional second
  // list as a disclaimer array). Lets the compiler source multi-list templates
  // (e.g. ins-outs) that the flattened scriptText can't represent.
  scriptRoles?: {
    hook: string;
    body: string[];
    cta?: string;
    disclaimer?: string;
    lists?: string[][];
  };

  // Narration type: 'recorded' (talking head), 'ai_voiceover' (TTS), or 'text_only' (text on screen)
  narrationType?: 'recorded' | 'ai_voiceover' | 'text_only';
  // AI voice ID (Kokoro voice) - only used when narrationType is 'ai_voiceover'
  // null = explicitly clear via deep merge
  aiVoiceId?: string | null;

  // Source talking head video
  // null = explicitly clear via deep merge
  talkingHeadAssetId?: string | null;
  talkingHeadUrl?: string | null;

  // B-roll clips that overlay the talking head (audio continues)
  bRollClips: BRollClipConfig[];

  // Caption settings (transcribed from talking head audio)
  captions: CaptionConfig;

  // Music settings
  musicTrackId?: string;
  musicUrl?: string;
  musicVolume: number;

  // Outro overlay settings
  // Optional: organic templates skip the outro entirely.
  outro?: OutroOverlayConfig;

  // Video orientation
  orientation: 'portrait' | 'landscape' | 'square';

  // PiP overlays (before/after photo thumbnails)
  pipOverlays?: PipOverlayConfig[];

  // Text frames for text-only narration mode (no voice, just text on screen)
  textFrames?: TextFrameDraftConfig[];

  // Offer card overlay for promotion videos (text/music only, no voice)
  offerCard?: OfferCardDraftConfig;

  // Organic template configs (text-on-b-roll, no narration). At most one is
  // populated per draft and the choice is driven by the selected variationId.
  captionTease?: CaptionTeaseDraftConfig;
  fadeBenefits?: FadeBenefitsDraftConfig;
  aestheticLine?: AestheticLineDraftConfig;
  numberedList?: NumberedListDraftConfig;
  insOuts?: InsOutsDraftConfig;
  questionCta?: QuestionCtaDraftConfig;
  improves?: ImprovesDraftConfig;
  stepTimer?: StepTimerDraftConfig;
  timeProgress?: TimeProgressDraftConfig;
  poll?: PollDraftConfig;
  mythFact?: MythFactDraftConfig;
  versus?: VersusDraftConfig;
  priceReveal?: PriceRevealDraftConfig;
  clientQuestion?: ClientQuestionDraftConfig;
  comeWithMe?: ComeWithMeDraftConfig;

  // Cached Whisper transcript (avoids re-transcribing when revisiting the step)
  transcriptText?: string | null;

  // User-edited caption text (overrides auto-generated captions during render)
  editedCaptionText?: string | null;
}

/**
 * Draft config for the caption-tease organic template (typewriter headline +
 * cursive caption). Mirrors `CaptionTeaseConfig` in @borradh-workspace/remotion.
 */
export interface CaptionTeaseDraftConfig {
  headline: string;
  emphasis?: string;
  emoji?: string;
  caption: string;
  charsPerSecond?: number;
}

/**
 * Draft config for the fade-benefits organic template (short benefit
 * statements revealed word-by-word with a fade). Mirrors `FadeBenefitsConfig`
 * in @borradh-workspace/remotion.
 */
export interface FadeBenefitsDraftConfig {
  lines: string[];
  secondsPerLine?: number;
  /** Highlight Caption mode — render each line on a solid brand-colour block. */
  highlight?: boolean;
  /** Fill colour for highlight blocks; injected from the org brand colour. */
  primaryColor?: string;
}

/**
 * Draft config for the aesthetic-line organic template (single understated
 * serif line). Mirrors `AestheticLineConfig` in @borradh-workspace/remotion.
 */
export interface AestheticLineDraftConfig {
  text: string;
}

/**
 * Draft config for the numbered-list organic template (title + numbered list
 * with badges). Mirrors `NumberedListConfig` in @borradh-workspace/remotion.
 */
export interface NumberedListDraftConfig {
  title: string;
  items: string[];
}

/**
 * Draft config for the ins-outs organic template (title + INS section + OUTS
 * section, items on single lines).
 */
export interface InsOutsDraftConfig {
  title: string;
  insLabel?: string;
  insItems: string[];
  outsLabel?: string;
  outsItems: string[];
}

/**
 * Draft config for the question-cta organic template (top question + bottom
 * "Read caption ⬇" CTA, black-fill-white-stroke).
 */
export interface QuestionCtaDraftConfig {
  question: string;
  ctaText: string;
}

/**
 * Draft config for the improves organic template (service name → per-clip
 * benefit beats → closing CTA, text synced to b-roll cuts).
 */
export interface ImprovesDraftConfig {
  serviceName: string;
  improvesLabel?: string;
  items: string[];
  ctaText: string;
}

/**
 * Draft config for the step-timer organic template (bold title + numbered
 * timed steps, one revealed per b-roll clip). Mirrors `StepTimerConfig` in
 * @borradh-workspace/remotion.
 */
export interface StepTimerDraftConfig {
  title: string;
  steps: Array<{ label: string; duration: string }>;
}

/**
 * Draft config for the time-progress organic template ("Day 1 → Day 30"
 * timestamp + caption over before→after footage). Mirrors
 * `TimeProgressConfig` in @borradh-workspace/remotion.
 */
export interface TimeProgressDraftConfig {
  startLabel: string;
  endLabel: string;
  caption: string;
}

/**
 * Draft config for the engagement-poll organic template: viewers vote with
 * Instagram's own actions (like / comment / optionally share), so results are
 * natively visible on the post and nothing is tallied server-side.
 */
export interface PollDraftConfig {
  question: string;
  likeLabel: string;
  commentLabel: string;
  shareLabel?: string;
}

/** Draft config for the myth-fact organic template. */
export interface MythFactDraftConfig {
  seriesTitle?: string;
  pairs: Array<{ myth: string; fact: string }>;
  ctaText?: string;
}

/** Draft config for the versus organic template. */
export interface VersusDraftConfig {
  treatmentA: string;
  treatmentB: string;
  rounds: Array<{ label: string; aValue: string; bValue: string }>;
  verdict: string;
}

/** Draft config for the price-reveal organic template. */
export interface PriceRevealDraftConfig {
  hook: string;
  items: Array<{ name: string; price: string }>;
  totalPrice: string;
  valueLine?: string;
}

/** Draft config for the client-question organic template. */
export interface ClientQuestionDraftConfig {
  question: string;
  asker: string;
  answers: string[];
  ctaText?: string;
}

/** Draft config for the come-with-me organic template. */
export interface ComeWithMeDraftConfig {
  title: string;
  seriesChip?: string;
  steps: string[];
  closingCta: string;
}

/**
 * Text frame configuration for text-only narration mode
 */
export interface TextFrameDraftConfig {
  id: string;
  text: string;
  durationSec: number;
  style?: 'default' | 'question' | 'answer' | 'disclaimer' | 'cta';
}

/**
 * Offer card configuration for promotion video overlays
 */
export interface OfferCardDraftConfig {
  serviceName: string;
  serviceDescription?: string;
  headline?: string;
  originalPriceCents?: number;
  offerPriceCents?: number;
  discountPercent?: number;
  bulletPoints?: string[];
  ctaText: string;
  urgencyText?: string;
  audienceText?: string;
  logoUrl?: string;
  businessName?: string;
  primaryColor?: string;
  secondaryColor?: string;
  currencyCode?: string;
}

/**
 * Video table - stores video projects (outputs)
 * Links to assets table for source material (inputs)
 */
export const video = pgTable(
  'video',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),

    // Status tracking for render pipeline
    status: videoStatusEnum('status').notNull().default('draft'),
    errorMessage: text('error_message'),
    progress: integer('progress').default(0),

    // Whether this video is intended for paid ads or organic social posts.
    // Current templates (before/after, talking head) all produce ad-suitable
    // creatives, so existing rows default to 'ad'. Organic video templates
    // are a separate workstream; once available the monthly batch flow
    // selects them by this enum.
    usageType: videoUsageTypeEnum('usage_type').notNull().default('ad'),

    // Processing stage tracking (detailed progress within 'processing' status)
    processingStage: videoProcessingStageEnum('processing_stage'),
    stageStartedAt: timestamp('stage_started_at'),

    // Draft configuration (JSON) - the Remotion input props
    draftConfig: jsonb('draft_config').$type<VideoDraftConfig>(),

    // Template engine routing. v1 uses the legacy Remotion config path;
    // v2 persists a compiled RenderDoc for deterministic retries.
    schemaVersion: integer('schema_version').notNull().default(1),
    renderDoc: jsonb('render_doc').$type<RenderDoc>(),

    // Wave 7 — Per-video synthesis overrides. Frozen content that the v1→v2
    // backfill captures so re-rendering a converted v1 video doesn't lose the
    // user's hand-edited script / pinned assets / per-video theme tweaks to
    // Claude regeneration. The synthesize-template service reads this on
    // re-synth: when present, frozenScript skips the Claude call,
    // frozenOfferContent overrides info-card slots, pinnedAssets pin
    // asset-media slot resolution, and themeOverrides flow through the
    // standard resolution cascade. Nullable — v2-native videos don't need it.
    synthesisOverrides: jsonb(
      'synthesis_overrides'
    ).$type<SynthesisOverrides>(),

    // Deterministic synthesis seed (§10 invariant 3). Set whenever the
    // synthesize step runs — either the caller-supplied value or one we
    // generate. Retries do NOT re-synthesize (they replay the persisted
    // `renderDoc` via `skipCompile`), so this is only read on the fresh
    // re-synthesis path ("regenerate this video with the same inputs").
    synthesisSeed: integer('synthesis_seed'),

    // Rendered output (populated after successful render)
    blobUrl: text('blob_url'),
    thumbnailUrl: text('thumbnail_url'),
    durationMs: integer('duration_ms'),

    // Template reference (content idea template used)
    templateId: text('template_id'),
    // Variation ID (randomly selected variation within the template)
    variationId: text('variation_id'),

    // Optional link to the organization service this video is about
    serviceId: text('service_id').references(() => organizationService.id, {
      onDelete: 'set null',
    }),

    // Optional link to the offer used in this video
    offerId: text('offer_id').references(() => offer.id, {
      onDelete: 'set null',
    }),

    // Ownership
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdById: text('created_by_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    // Timestamps
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at'),
    exportedAt: timestamp('exported_at'),
  },
  (table) => [
    index('idx_video_org_id').on(table.organizationId),
    index('idx_video_created_by_id').on(table.createdById),
    index('idx_video_org_usage_type').on(table.organizationId, table.usageType),
  ]
);

export const videoRlsPolicy = orgRlsPolicy(video);

export const videoRelations = relations(video, ({ one }) => ({
  organization: one(organization, {
    fields: [video.organizationId],
    references: [organization.id],
  }),
  createdBy: one(user, {
    fields: [video.createdById],
    references: [user.id],
  }),
  service: one(organizationService, {
    fields: [video.serviceId],
    references: [organizationService.id],
  }),
  offer: one(offer, {
    fields: [video.offerId],
    references: [offer.id],
  }),
}));

export type Video = typeof video.$inferSelect;
export type NewVideo = typeof video.$inferInsert;
