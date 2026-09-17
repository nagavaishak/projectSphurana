/**
 * content request CONTRACTS — the canonical, strict Zod schema for the BODY of
 * each content-production write endpoint: social posts, media assets, the
 * AI copy/script/graphic generators, voice scripts, and batch acceptance.
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. Each feature schema DERIVES from it by `.extend()`ing
 * the server-injected context fields onto the base:
 *
 *     createSocialPostSchema = createSocialPostRequestBase
 *       .extend({ organizationId, createdById })
 *       .refine(…)                        // cross-field invariant, re-applied
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this. (This domain is where drift had already happened: the
 * `CreateSocialPostDto` in apps/api was a HAND-COPY of the feature schema that
 * had silently lost `mediaUrls` and `status`, so a carousel post assembled by
 * the client was accepted and then published as a single image.)
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 * `.refine()` returns a `ZodEffects`, which has NO `.extend()`. So every
 * contract exports a matched pair:
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE, NOT strict
 *    (`.strict()` would reject the very context fields being added).
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()` plus any `.refine()`.
 *    VALIDATES a wire body; unknown keys are rejected rather than silently
 *    stripped.
 *
 * Context fields the SERVER injects, absent from every body here:
 *  - `organizationId` — from the active-org session.
 *  - `createdById` / `uploadedById` — the authenticated user.
 *  - route-param ids (`itemId` on `POST content-batches/items/:itemId/accept`).
 */
import {
  assetSourceValues,
  graphicCategoryValues,
  placeholderTypeValues,
  socialPlatformValues,
  socialPostMediaTypeValues,
  socialPostStatusValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

// ── Social posts ──────────────────────────────────────────────────────────

/**
 * `POST social-posts` body — the EXTENDABLE half.
 *
 * Two mutually-supporting targeting modes:
 *  1. `platforms` (+ optional `platformSettings`) — name the platforms directly.
 *  2. `pageIds` — hand over connected Meta page ids and let the server derive
 *     the platforms (and fill in `platformSettings`) from them.
 *
 * At least one must be present. That invariant lives on the SCHEMA half (as a
 * `.refine()`), not the base, because `.refine()` would make the base
 * un-`.extend()`able — the feature schema re-applies it after extending.
 *
 * `mediaUrls` is the carousel channel: 2+ entries publish as a carousel and the
 * first entry is reconciled to `mediaUrl`. Omit it (or send one entry) for a
 * normal single-media post. This field is the one that had gone missing from
 * the hand-copied API DTO — a client could send a carousel and get a single
 * image with no error, which is why it is called out here.
 *
 * `scheduledAt` uses `z.coerce.date()`: the wire carries an ISO string and the
 * server wants a `Date`, and the coercion is kept ON THE CONTRACT so the
 * derived server schema behaves identically. Absent/`null` means "draft".
 */
export const createSocialPostRequestBase = z.object({
  // Post content
  title: z.string().min(1, 'Title is required'),
  caption: z.string().optional(),

  // Media
  mediaType: z.enum(socialPostMediaTypeValues),
  mediaUrl: z.string().url('Invalid media URL'),
  /**
   * Ordered media URLs for a multi-image carousel. 2+ entries → carousel; the
   * first entry must match (or is reconciled to) `mediaUrl`.
   */
  mediaUrls: z.array(z.string().url('Invalid media URL')).optional(),
  thumbnailUrl: z.string().url('Invalid thumbnail URL').optional(),
  videoId: z.string().optional(),
  graphicId: z.string().optional(),

  // Target platforms — direct specification…
  platforms: z.array(z.enum(socialPlatformValues)).optional(),
  // …or Meta page ids the server derives the platforms from.
  pageIds: z.array(z.string().min(1)).optional(),

  /** Auto-populated server-side when `pageIds` is used. */
  platformSettings: z
    .object({
      facebook: z.object({ pageId: z.string().optional() }).optional(),
      instagram: z.object({ accountId: z.string().optional() }).optional(),
    })
    .optional(),

  /** Absent / `null` → draft. */
  scheduledAt: z.coerce.date().optional().nullable(),

  /** Defaults server-side to `draft`, or `scheduled` when `scheduledAt` is set. */
  status: z.enum(['draft', 'scheduled']).optional(),
});

/**
 * The cross-field invariant, exported so the derived feature schema can
 * re-apply it after `.extend()` (a `.refine()` cannot survive an extend).
 */
export const socialPostTargetRefinement = (data: {
  platforms?: string[];
  pageIds?: string[];
}) =>
  (data.platforms !== undefined && data.platforms.length > 0) ||
  (data.pageIds !== undefined && data.pageIds.length > 0);

/** The message + path attached to {@link socialPostTargetRefinement}. */
export const socialPostTargetRefinementOptions = {
  message: 'Either platforms or pageIds must be provided',
  path: ['platforms'] as const,
};

/** `POST social-posts` body — the VALIDATING half. */
export const createSocialPostRequestSchema = createSocialPostRequestBase
  .strict()
  .refine(socialPostTargetRefinement, {
    message: socialPostTargetRefinementOptions.message,
    path: [...socialPostTargetRefinementOptions.path],
  });

export type CreateSocialPostRequest = z.infer<
  typeof createSocialPostRequestSchema
>;

/**
 * `PUT social-posts/:id` body — the EXTENDABLE half.
 *
 * A PATCH: every field is optional and an absent key means "leave unchanged".
 * That is why `title` is `.min(1).optional()` — you may omit it, but you may
 * not blank it.
 *
 * ABSENT vs `null` is load-bearing on the nullable fields. `caption: null`
 * CLEARS the caption; omitting `caption` keeps it. Same for `thumbnailUrl`,
 * `videoId`, `platformSettings` and — most importantly — `scheduledAt`, where
 * `null` UNSCHEDULES the post back to a draft and absent leaves the existing
 * schedule alone.
 *
 * `status` is DELIBERATELY NARROWER than the `socialPostStatusValues`
 * vocabulary: a client may only move a post between `draft` and `scheduled`.
 * `publishing` / `published` / `partial` / `failed` are terminal states owned
 * by the publisher worker, and accepting them here would let a client claim a
 * post was published without anything having been sent to Meta. It is derived
 * via `.extract()` rather than hand-typed so that renaming or removing a status
 * in the labels vocabulary is a COMPILE error here, not silent drift.
 *
 * `scheduledAt` is `z.coerce.date()`: the wire carries an ISO string and the
 * server wants a `Date`. Because the coercion lives on the contract, PARSING a
 * body yields a `Date`. A frontend builder that must keep emitting the ISO
 * string should therefore `.parse()` for validation but send the ORIGINAL
 * object, and type its body with `z.input<…>` rather than `z.infer<…>`.
 *
 * Context fields the SERVER injects, absent here:
 *  - `id`             — the `:id` route param.
 *  - `organizationId` — from the active-org session.
 */
export const updateSocialPostRequestBase = z.object({
  // Post content
  title: z.string().min(1, 'Title cannot be empty').optional(),
  /** `null` clears the caption. */
  caption: z.string().optional().nullable(),

  // Media
  mediaType: z.enum(socialPostMediaTypeValues).optional(),
  mediaUrl: z.string().url('Invalid media URL').optional(),
  thumbnailUrl: z.string().url('Invalid thumbnail URL').optional().nullable(),
  videoId: z.string().optional().nullable(),

  // Target platforms
  platforms: z
    .array(z.enum(socialPlatformValues))
    .min(1, 'At least one platform must be selected')
    .optional(),

  // Platform-specific settings
  platformSettings: z
    .object({
      facebook: z.object({ pageId: z.string().optional() }).optional(),
      instagram: z.object({ accountId: z.string().optional() }).optional(),
    })
    .optional()
    .nullable(),

  /** `null` → back to draft; absent → keep the existing schedule. */
  scheduledAt: z.coerce.date().optional().nullable(),

  /**
   * Only `draft` / `scheduled` are client-settable — see the doc comment above.
   * `.extract()` keeps this tied to the labels vocabulary.
   */
  status: z
    .enum(socialPostStatusValues)
    .extract(['draft', 'scheduled'])
    .optional(),
});

/** `PUT social-posts/:id` body — the VALIDATING half. */
export const updateSocialPostRequestSchema =
  updateSocialPostRequestBase.strict();

export type UpdateSocialPostRequest = z.infer<
  typeof updateSocialPostRequestSchema
>;

// ── Assets ────────────────────────────────────────────────────────────────

/**
 * `POST assets` body — the EXTENDABLE half.
 *
 * `source` is the field with teeth: `raw` footage goes through AI analysis
 * (transcription, face grouping, clip selection) while edited/polished media
 * does not. It defaults to `raw`, and like every `.default()` here it
 * MATERIALISES into the parsed body.
 *
 * `blobUrl` is `.url()`, so an upload flow that has not yet resolved a URL must
 * not send `''` — that is a parse error client-side now, not a server 400.
 */
export const createAssetRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
  blobUrl: z.string().url('Invalid URL'),
  sourceFileName: z.string().optional(),
  tags: z.array(z.string()).default([]),
  clientName: z.string().optional(),
  type: z.enum(['video', 'image']).default('video'),
  /** `raw` footage gets AI analysis; edited/polished does not. */
  source: z.enum(assetSourceValues).default('raw'),
  /** Slots this asset may fill (e.g. `owner_bodyshot`, `client_result`). */
  placeholderTypes: z.array(z.enum(placeholderTypeValues)).default([]),
  /** Videos only. */
  duration: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  transcript: z.string().optional(),
  capturedAt: z.string().datetime().optional(),
  batchId: z.string().optional(),
});

/** `POST assets` body — the VALIDATING half. */
export const createAssetRequestSchema = createAssetRequestBase.strict();

export type CreateAssetRequest = z.infer<typeof createAssetRequestSchema>;

// ── AI copy generators ────────────────────────────────────────────────────

/**
 * `POST ai-content/generate` body — the EXTENDABLE half. Generates a caption /
 * ad copy for an already-rendered piece of media.
 *
 * `includeOffer` is an EXPLICIT opt-in, deliberately not inferred: price-led
 * copy is a regulated claim in this vertical, so it is never switched on by a
 * heuristic.
 */
export const generateContentRequestBase = z.object({
  mediaType: z.enum(['video', 'image']),
  mediaId: z.string().min(1, 'Media ID is required'),
  contentType: z.enum(['social-post', 'ad']),
  platform: z.enum(socialPlatformValues).optional(),
  /** Used to match pre-written treatment captions. */
  serviceIds: z.array(z.string()).optional(),
  /** Explicit opt-in for price-led intro-offer copy. */
  includeOffer: z.boolean().optional(),
});

/** `POST ai-content/generate` body — the VALIDATING half. */
export const generateContentRequestSchema = generateContentRequestBase.strict();

export type GenerateContentRequest = z.infer<
  typeof generateContentRequestSchema
>;

/**
 * `POST ai-content/generate-offer-content` body — the EXTENDABLE half.
 * Both fields optional: with neither, the generator picks the org's headline
 * offer itself.
 */
export const generateOfferContentRequestBase = z.object({
  serviceId: z.string().min(1).optional(),
  headline: z.string().optional(),
});

/** `POST ai-content/generate-offer-content` body — the VALIDATING half. */
export const generateOfferContentRequestSchema =
  generateOfferContentRequestBase.strict();

export type GenerateOfferContentRequest = z.infer<
  typeof generateOfferContentRequestSchema
>;

/**
 * `POST ai-content/generate-offer-copy` body — the EXTENDABLE half. Produces
 * the full video-copy bundle (headline, CTA, urgency, audience, bullets) for
 * one offer on demand.
 *
 * `refinementInstruction` + `priorCopy` together are the RE-ROLL protocol: send
 * both and the generator applies only the requested change to the prior copy
 * instead of starting fresh. `priorCopy` is `z.record(z.string(), z.unknown())`
 * because its shape is whichever per-template copy block the caller last got
 * back — pinning it here would couple this contract to every template.
 */
export const generateOfferCopyRequestBase = z.object({
  offerId: z.string().min(1, 'Offer ID is required'),
  /** Free-text steer — upfront guidance or a re-roll change. */
  refinementInstruction: z.string().max(500).optional(),
  /** Previously generated copy, for refinement-aware re-rolls. */
  priorCopy: z.record(z.string(), z.unknown()).optional(),
});

/** `POST ai-content/generate-offer-copy` body — the VALIDATING half. */
export const generateOfferCopyRequestSchema =
  generateOfferCopyRequestBase.strict();

export type GenerateOfferCopyRequest = z.infer<
  typeof generateOfferCopyRequestSchema
>;

/**
 * Variation IDs the organic-copy generator accepts. Mirrors the organic-template
 * subset of the remotion package's variation ids — kept in sync BY HAND on
 * purpose, so a newly-added template cannot silently start accepting requests
 * before its copywriter prompt exists.
 */
export const organicVariationIdRequestSchema = z.enum([
  'caption-tease-1',
  'fade-benefits-1',
  'aesthetic-line-1',
  'numbered-list-1',
  'ins-outs-1',
  'question-cta-1',
  'improves-1',
  'highlight-caption-1',
  'curiosity-hook-1',
  'step-timer-1',
  'time-progress-1',
  'poll-1',
  'myth-fact-1',
  'versus-1',
  'price-reveal-1',
  'client-question-1',
  'come-with-me-1',
]);

/**
 * `POST videos/generate-organic-copy` body — the EXTENDABLE half. Same re-roll
 * protocol as offer copy (see {@link generateOfferCopyRequestBase}).
 */
export const generateOrganicCopyRequestBase = z.object({
  variationId: organicVariationIdRequestSchema,
  /** When set, the prompt focuses on this single service. */
  serviceId: z.string().optional(),
  refinementInstruction: z.string().max(500).optional(),
  priorCopy: z.record(z.string(), z.unknown()).optional(),
});

/** `POST videos/generate-organic-copy` body — the VALIDATING half. */
export const generateOrganicCopyRequestSchema =
  generateOrganicCopyRequestBase.strict();

export type GenerateOrganicCopyRequest = z.infer<
  typeof generateOrganicCopyRequestSchema
>;

/**
 * `POST videos/generate-video-script` body — the EXTENDABLE half.
 *
 * `templateId` and `variationId` are both REQUIRED: a script is written against
 * a specific template's beat structure, so there is no sensible default.
 * `narrationMode` changes what gets written (a `text_only` script is on-screen
 * text, not spoken lines), not merely how it is rendered.
 */
export const generateVideoScriptRequestBase = z.object({
  templateId: z.string().min(1, 'Template ID is required'),
  variationId: z.string().min(1, 'Variation ID is required'),
  serviceId: z.string().optional(),
  narrationMode: z.enum(['recorded', 'ai_voiceover', 'text_only']).optional(),
  /** Free-text steer — upfront guidance or a re-roll change. */
  refinementInstruction: z.string().max(500).optional(),
  /** The previously generated script, for refinement-aware re-rolls. */
  priorScriptText: z.string().optional(),
});

/** `POST videos/generate-video-script` body — the VALIDATING half. */
export const generateVideoScriptRequestSchema =
  generateVideoScriptRequestBase.strict();

export type GenerateVideoScriptRequest = z.infer<
  typeof generateVideoScriptRequestSchema
>;

// ── Graphics ──────────────────────────────────────────────────────────────

/**
 * `POST graphics/generate` body — the EXTENDABLE half.
 *
 * Three independent image-sourcing switches, and their defaults encode a
 * deliberate policy:
 *  - `allowAiImages` defaults FALSE — a clinic's graphics use its own uploaded
 *    photos unless the owner explicitly opts into AI imagery.
 *  - `allowStockImages` defaults TRUE — curated licensed stock is an acceptable
 *    fallback, so only an explicit `false` turns it off.
 *  - `sourceAssetIds`, when present, PINS the subject imagery to exactly those
 *    assets in that order (1–10), overriding auto-selection.
 *
 * `offerId` is required when `usageType` is `ad` — enforced in the SERVICE, not
 * here, because that check needs to look the offer up.
 */
export const generateGraphicFromServiceRequestBase = z.object({
  serviceId: z.string().min(1, 'serviceId is required'),
  /** Editorial category the organic planner filters templates by. */
  category: z.enum(graphicCategoryValues).default('tips'),
  /** Omitted → synthesised from the service name. */
  topicSummary: z.string().min(1).optional(),
  /** Omitted → `single` or `carousel` picked uniformly at random. */
  kind: z.enum(['single', 'carousel']).optional(),
  allowAiImages: z.boolean().default(false),
  sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  allowStockImages: z.boolean().default(true),
  /** `organic` = social post, `ad` = paid offer ad. */
  usageType: z.enum(['organic', 'ad']).default('organic'),
  /** REQUIRED when `usageType` is `ad` (enforced in the service). */
  offerId: z.string().min(1).optional(),
  /** Free-text steer from the create-post dialog. */
  refinementInstruction: z.string().max(500).optional(),
  /**
   * An item opened for this content BEFORE it was made — a proposal the owner
   * was shown and has now accepted. Fills its attempt 0 rather than opening a
   * second item, so the card that proposed it can tell it has been acted on.
   */
  itemId: z.string().min(1).optional(),
  /**
   * Curated template slug. When set the worker renders exactly this template
   * and `kind` is DERIVED from which registry the slug belongs to — a carousel
   * slug forces `carousel`, a single slug forces `single`.
   */
  templateSlug: z.string().min(1).optional(),
  /** Async WhatsApp delivery on completion (mirrors the video pipeline). */
  whatsappDelivery: z
    .object({
      conversationId: z.string().min(1),
      userId: z.string().min(1),
    })
    .optional(),
});

/** `POST graphics/generate` body — the VALIDATING half. */
export const generateGraphicFromServiceRequestSchema =
  generateGraphicFromServiceRequestBase.strict();

export type GenerateGraphicFromServiceRequest = z.infer<
  typeof generateGraphicFromServiceRequestSchema
>;

// ── Voice scripts ─────────────────────────────────────────────────────────

/**
 * `POST voice-scripts` body — the EXTENDABLE half.
 *
 * `agentConfig` is `.passthrough()` — the ONE intentionally-open object in this
 * file. It is forwarded verbatim to the telephony provider, whose option set
 * moves independently of us; the named keys are the ones we read ourselves.
 *
 * Note `isDefault` defaults TRUE: creating a script makes it the active one
 * unless the caller says otherwise.
 */
export const createVoiceScriptRequestBase = z.object({
  name: z.string().min(1, 'Script name is required').default('Default Script'),
  isDefault: z.boolean().default(true),
  initialMessage: z.string().min(1, 'Initial message is required'),
  /** The AI agent's system prompt. */
  script: z.string().optional(),
  qualificationQuestions: z.array(z.string()).default([]),
  followUps: z.array(z.string()).default([]),
  agentConfig: z
    .object({
      voice: z.string().optional(),
      language: z.string().optional(),
      maxCallDuration: z.number().optional(),
      endCallAfterSilence: z.number().optional(),
    })
    .passthrough()
    .optional(),
});

/** `POST voice-scripts` body — the VALIDATING half. */
export const createVoiceScriptRequestSchema =
  createVoiceScriptRequestBase.strict();

export type CreateVoiceScriptRequest = z.infer<
  typeof createVoiceScriptRequestSchema
>;

/**
 * `PUT voice-scripts/:id` body — the EXTENDABLE half.
 *
 * A PATCH: every field is optional, and a field two surfaces both touch can
 * only be encoded one way. Unlike {@link createVoiceScriptRequestBase} there
 * are NO `.default()`s — a default on an update would silently rewrite a field
 * the caller never mentioned, which is the opposite of what a partial update
 * means. That is also why `name` / `initialMessage` are `.min(1).optional()`:
 * omit them, but do not blank them.
 *
 * `script` (the AI agent's system prompt) is `.nullable()` because the
 * ai-assistant directive card CLEARS it when the chatbot directive is removed —
 * `null` means "clear", absent means "leave alone". `agentConfig` is nullable
 * for the same reason, and is `.passthrough()` for the same reason it is on
 * create: it is forwarded verbatim to the telephony provider, whose option set
 * moves independently of us.
 *
 * `voiceProviderAgentId` is NOT part of this contract, by design. The API DTO
 * used to accept it, but `updateVoiceScript` never read it — the service parsed
 * it straight back off — so it was a field a client could send that did
 * nothing. Do not add it back without a service that writes it.
 *
 * Context fields the SERVER injects, absent here:
 *  - `id`             — the `:id` route param.
 *  - `organizationId` — from the active-org session.
 */
export const updateVoiceScriptRequestBase = z.object({
  name: z.string().min(1, 'Script name is required').optional(),
  isDefault: z.boolean().optional(),
  initialMessage: z.string().min(1, 'Initial message is required').optional(),
  /** The AI agent's system prompt; `null` clears it. */
  script: z.string().optional().nullable(),
  qualificationQuestions: z.array(z.string()).optional(),
  followUps: z.array(z.string()).optional(),
  agentConfig: z
    .object({
      voice: z.string().optional(),
      language: z.string().optional(),
      maxCallDuration: z.number().optional(),
      endCallAfterSilence: z.number().optional(),
    })
    .passthrough()
    .optional()
    .nullable(),
});

/** `PUT voice-scripts/:id` body — the VALIDATING half. */
export const updateVoiceScriptRequestSchema =
  updateVoiceScriptRequestBase.strict();

export type UpdateVoiceScriptRequest = z.infer<
  typeof updateVoiceScriptRequestSchema
>;

// ── Face groups ───────────────────────────────────────────────────────────

/**
 * `PUT face-groups/:id` body — the EXTENDABLE half.
 *
 * A face group is the AI's clustering of one client's before/after media; this
 * endpoint is how a human corrects it. A PATCH — the batch review card sends
 * only `clientName`, the onboarding before/after row's service picker fires its
 * own separate PUT carrying only `serviceId`.
 *
 * `clientName` is `.min(1).optional()`: rename it or leave it, but an unnamed
 * group is not a state the server will store. `serviceId` is `.min(1)` AND
 * nullable for the same reason — `null` DETACHES the service, `''` is not a
 * detach, it is a malformed id.
 *
 * `isExcluded` is NOT part of this contract. The frontend builder used to send
 * it and no surface ever set it; there is no such column and no such field on
 * any server schema, so it was silently stripped by the DTO. It is dropped
 * rather than added, because "exclude this group from the batch" is not a
 * behaviour that exists yet.
 *
 * Context fields the SERVER injects, absent here:
 *  - `id`             — the `:groupId` route param.
 *  - `organizationId` — from the active-org session.
 */
export const updateFaceGroupRequestBase = z.object({
  clientName: z.string().min(1).optional(),
  clientNotes: z.string().optional().nullable(),
  /** `null` detaches the service; a present value must be a real id. */
  serviceId: z.string().min(1).optional().nullable(),
});

/** `PUT face-groups/:id` body — the VALIDATING half. */
export const updateFaceGroupRequestSchema = updateFaceGroupRequestBase.strict();

export type UpdateFaceGroupRequest = z.infer<
  typeof updateFaceGroupRequestSchema
>;

// ── Video drafts ──────────────────────────────────────────────────────────

/**
 * THE `draftConfig` — the whole editable state of a draft video, and by a wide
 * margin the largest single object on the wire in this workspace.
 *
 * It lives HERE, in the contract, rather than in packages/features, because
 * three endpoints all carry it and each used to describe it differently:
 * `POST videos` (partial, merged over synthesised defaults), `PUT videos/:id`
 * (shallow-partial patch) and `PATCH videos/:id/draft-config` (partial,
 * deep-merged). The feature schemas now RE-EXPORT these under their historical
 * names, so `draftConfigSchema` / `partialDraftConfigSchema` /
 * `offerCardDraftConfigSchema` still resolve from
 * `@borradh-workspace/features/videos` for the worker and the assistant tools.
 *
 * The design is deliberately FLAT and template-agnostic: every template reads
 * the fields it cares about and ignores the rest. `bRollClips`, `captions`,
 * `musicVolume` and `orientation` are the only REQUIRED keys — the render
 * pipeline has no sensible default for them — which is why the create and
 * patch paths use {@link partialDraftConfigSchema} and only the final
 * `createVideo` insert validates against the strict {@link draftConfigSchema}.
 *
 * Note this object is NOT `.strict()`. It is stored as JSON on the video row
 * and read back by the worker; an unknown key is dropped on parse rather than
 * rejected, so a client running older code against a newer template set
 * degrades instead of 400ing. The strictness that matters is on the request
 * ENVELOPE (title / templateId / draftConfig / …), which is where a typo
 * actually costs you a silently-lost field.
 *
 * `null` vs absent is load-bearing on the deep-merged patch path:
 * `talkingHeadAssetId: null` CLEARS the talking head, absent leaves it.
 */

/**
 * B-roll clip configuration schema
 * Note: url is optional - it's resolved from assetId by the video-worker during rendering
 */
const bRollClipConfigSchema = z.object({
  assetId: z.string().min(1),
  url: z.string().optional(), // Resolved from asset table during rendering
  order: z.number().int().min(0),
  clipType: z.enum(['before', 'after', 'bRoll']).optional(),
});

/**
 * Caption configuration schema
 */
const captionConfigSchema = z.object({
  enabled: z.boolean(),
  position: z.enum(['top', 'center', 'bottom']),
  fontFamily: z.string(),
  fontSize: z.number().int().positive(),
  textColor: z.string(),
  highlightColor: z.string(),
  backgroundColor: z.string(),
  showBackground: z.boolean(),
});

/**
 * Outro overlay configuration schema
 */
const outroOverlayConfigSchema = z.object({
  logoUrl: z.string().optional(),
  businessName: z.string().min(1),
  ctaText: z.string().min(1),
  backgroundOpacity: z.number().min(0).max(1),
  backgroundColor: z.string(),
  textColor: z.string(),
  durationSec: z.number().positive(),
  outroStyle: z.enum(['offer', 'location', 'tagline']).optional(),
});

/**
 * PiP overlay configuration schema
 */
const pipOverlayConfigSchema = z.object({
  imageUrl: z.string(),
  label: z.string().optional(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  startSec: z.number().min(0),
  durationSec: z.number().positive(),
  sizePercent: z.number().min(1).max(100).optional(),
  soundEffectUrl: z.string().optional(),
});

/**
 * Text frame configuration schema (text-only narration mode)
 */
const textFrameDraftConfigSchema = z.object({
  id: z.string(),
  text: z.string(),
  durationSec: z.number().positive(),
  style: z
    .enum(['default', 'question', 'answer', 'disclaimer', 'cta'])
    .optional(),
});

/**
 * Offer card configuration schema (promotion video overlays)
 */
export const offerCardDraftConfigSchema = z.object({
  serviceName: z.string(),
  serviceDescription: z.string().optional(),
  headline: z.string().optional(),
  originalPriceCents: z.number().int().optional(),
  offerPriceCents: z.number().int().optional(),
  discountPercent: z.number().optional(),
  bulletPoints: z.array(z.string()).optional(),
  ctaText: z.string(),
  urgencyText: z.string().optional(),
  audienceText: z.string().optional(),
  logoUrl: z.string().optional(),
  businessName: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  currencyCode: z.string().optional(),
});

/**
 * Organic template draft config schemas. Each maps to a single variationId
 * and is the only template-specific copy block the user supplies (no script,
 * no narration, no captions).
 */
const captionTeaseDraftConfigSchema = z.object({
  headline: z.string().min(1),
  emphasis: z.string().optional(),
  emoji: z.string().optional(),
  caption: z.string().min(1),
  charsPerSecond: z.number().min(4).max(120).optional(),
});

const fadeBenefitsDraftConfigSchema = z.object({
  lines: z.array(z.string().min(1)).min(1).max(8),
  secondsPerLine: z.number().min(1).max(8).optional(),
  /** Highlight Caption mode — render each line on a solid brand-colour block. */
  highlight: z.boolean().optional(),
  /** Fill colour for highlight blocks; injected from the org brand colour. */
  primaryColor: z.string().optional(),
});

const aestheticLineDraftConfigSchema = z.object({
  text: z.string().min(1),
});

const numberedListDraftConfigSchema = z.object({
  title: z.string().min(1),
  items: z.array(z.string().min(1)).min(2).max(8),
});

const insOutsDraftConfigSchema = z.object({
  title: z.string().min(1),
  insLabel: z.string().optional(),
  insItems: z.array(z.string().min(1)).min(1).max(12),
  outsLabel: z.string().optional(),
  outsItems: z.array(z.string().min(1)).min(1).max(12),
});

const questionCtaDraftConfigSchema = z.object({
  question: z.string().min(1),
  ctaText: z.string().min(1),
});

const improvesDraftConfigSchema = z.object({
  serviceName: z.string().min(1),
  improvesLabel: z.string().optional(),
  items: z.array(z.string().min(1)).min(1).max(8),
  ctaText: z.string().min(1),
});

const stepTimerDraftConfigSchema = z.object({
  title: z.string().min(1),
  steps: z
    .array(
      z.object({
        label: z.string().min(1),
        duration: z.string().min(1),
      })
    )
    .min(1)
    .max(6),
});

const timeProgressDraftConfigSchema = z.object({
  startLabel: z.string().min(1),
  endLabel: z.string().min(1),
  caption: z.string().min(1),
});

const mythFactDraftConfigSchema = z.object({
  seriesTitle: z.string().optional(),
  pairs: z
    .array(z.object({ myth: z.string().min(1), fact: z.string().min(1) }))
    .min(1)
    .max(3),
  ctaText: z.string().optional(),
});

const versusDraftConfigSchema = z.object({
  treatmentA: z.string().min(1),
  treatmentB: z.string().min(1),
  rounds: z
    .array(
      z.object({
        label: z.string().min(1),
        aValue: z.string().min(1),
        bValue: z.string().min(1),
      })
    )
    .min(2)
    .max(4),
  verdict: z.string().min(1),
});

const priceRevealDraftConfigSchema = z.object({
  hook: z.string().min(1),
  items: z
    .array(z.object({ name: z.string().min(1), price: z.string().min(1) }))
    .min(2)
    .max(5),
  totalPrice: z.string().min(1),
  valueLine: z.string().optional(),
});

const clientQuestionDraftConfigSchema = z.object({
  question: z.string().min(1),
  asker: z.string().min(1),
  answers: z.array(z.string().min(1)).min(2).max(5),
  ctaText: z.string().optional(),
});

const comeWithMeDraftConfigSchema = z.object({
  title: z.string().min(1),
  seriesChip: z.string().optional(),
  steps: z.array(z.string().min(1)).min(3).max(7),
  closingCta: z.string().min(1),
});

const pollDraftConfigSchema = z.object({
  question: z.string().min(1),
  likeLabel: z.string().min(1),
  commentLabel: z.string().min(1),
  shareLabel: z.string().optional(),
});

/**
 * Draft config schema - matches VideoDraftConfig in database
 * Flexible design that works with any template type
 */
export const draftConfigSchema = z.object({
  // User-edited script text (synced to mobile teleprompter)
  scriptText: z.string().optional(),

  // Structured script roles from v2 synthesis. Carries hook/body/cta plus an
  // optional second list (disclaimer as array) that the flattened scriptText
  // can't represent — needed by multi-list templates (e.g. ins-outs).
  scriptRoles: z
    .object({
      hook: z.string(),
      body: z.array(z.string()),
      cta: z.string().optional(),
      disclaimer: z.string().optional(),
      lists: z.array(z.array(z.string())).optional(),
    })
    .optional(),

  // Narration type: 'recorded' (talking head), 'ai_voiceover' (TTS), or 'text_only' (text on screen)
  narrationType: z.enum(['recorded', 'ai_voiceover', 'text_only']).optional(),
  // AI voice ID (Kokoro voice) - only used when narrationType is 'ai_voiceover'
  // null = explicitly clear the field during deep merge
  aiVoiceId: z.string().nullable().optional(),

  // Source talking head video
  // null = explicitly clear the field during deep merge
  talkingHeadAssetId: z.string().nullable().optional(),
  talkingHeadUrl: z.string().nullable().optional(),

  // B-roll clips that overlay the talking head (audio continues)
  bRollClips: z.array(bRollClipConfigSchema),

  // Caption settings (transcribed from talking head audio)
  captions: captionConfigSchema,

  // Music settings
  musicTrackId: z.string().optional(),
  musicUrl: z.string().optional(),
  musicVolume: z.number().min(0).max(1),

  // Outro overlay settings
  // Organic templates render with no outro; ad/talking-head templates set
  // one. Optional to support both — when omitted, the worker skips outro
  // assembly entirely.
  outro: outroOverlayConfigSchema.optional(),

  // Video orientation
  orientation: z.enum(['portrait', 'landscape', 'square']),

  // PiP overlays (before/after photo thumbnails)
  pipOverlays: z.array(pipOverlayConfigSchema).optional(),

  // Text frames for text-only narration mode (no voice, just text on screen)
  textFrames: z.array(textFrameDraftConfigSchema).optional(),

  // Offer card overlay for promotion videos (text/music only, no voice)
  offerCard: offerCardDraftConfigSchema.optional(),

  // Organic templates — at most one populated per draft, gated by variationId.
  captionTease: captionTeaseDraftConfigSchema.optional(),
  fadeBenefits: fadeBenefitsDraftConfigSchema.optional(),
  aestheticLine: aestheticLineDraftConfigSchema.optional(),
  numberedList: numberedListDraftConfigSchema.optional(),
  insOuts: insOutsDraftConfigSchema.optional(),
  questionCta: questionCtaDraftConfigSchema.optional(),
  improves: improvesDraftConfigSchema.optional(),
  stepTimer: stepTimerDraftConfigSchema.optional(),
  timeProgress: timeProgressDraftConfigSchema.optional(),
  poll: pollDraftConfigSchema.optional(),
  mythFact: mythFactDraftConfigSchema.optional(),
  versus: versusDraftConfigSchema.optional(),
  priceReveal: priceRevealDraftConfigSchema.optional(),
  clientQuestion: clientQuestionDraftConfigSchema.optional(),
  comeWithMe: comeWithMeDraftConfigSchema.optional(),

  // Cached Whisper transcript (avoids re-transcribing when revisiting the step)
  transcriptText: z.string().nullable().optional(),

  // User-edited caption text (overrides auto-generated captions during render)
  editedCaptionText: z.string().nullable().optional(),
});

export type DraftConfig = z.infer<typeof draftConfigSchema>;

/**
 * Draft-config shape for PARTIAL inputs — the one-prompt create overrides and
 * the in-chat patch tool. Same as `draftConfigSchema.partial()`, but the
 * nested `offerCard` is ALSO partial, so Claire can override/patch just the
 * offer copy (e.g. only the headline) without resending serviceName/ctaText —
 * the builder (create) or deep-merge (patch) fills those in. The strict
 * `draftConfigSchema` is still used for the final `createVideo` insert, so the
 * database contract (`VideoDraftConfig`) stays intact.
 */
/**
 * `.partial()` only reaches the TOP LEVEL, and every nested block on this
 * config is an all-or-nothing object underneath it.
 *
 * So `{ captionTease: { headline: 'x' } }` was rejected for the missing
 * `caption` — on a PATCH endpoint whose entire job is partial updates, and
 * whose merge (`deepMergeDraftConfig`) shallow-merges nested plain objects and
 * would have handled it correctly. `offerCard` was the only block anyone had
 * partialled, which is why an offer video could be reworded field-by-field and
 * no other template could: asked to change a Caption Tease headline, the server
 * 400'd, Claire retried, reached for the script generator, and told the owner
 * to email support about a supported edit.
 *
 * Listed exhaustively rather than mapped, because `.partial()` is only correct
 * for OBJECT values: the arrays (`bRollClips`, `textFrames`, `pipOverlays`) are
 * wholesale replacements and partialling them would mean nothing.
 */
export const partialDraftConfigSchema = draftConfigSchema.partial().extend({
  captions: captionConfigSchema.partial().optional(),
  outro: outroOverlayConfigSchema.partial().optional(),
  offerCard: offerCardDraftConfigSchema.partial().optional(),
  captionTease: captionTeaseDraftConfigSchema.partial().optional(),
  fadeBenefits: fadeBenefitsDraftConfigSchema.partial().optional(),
  aestheticLine: aestheticLineDraftConfigSchema.partial().optional(),
  numberedList: numberedListDraftConfigSchema.partial().optional(),
  insOuts: insOutsDraftConfigSchema.partial().optional(),
  questionCta: questionCtaDraftConfigSchema.partial().optional(),
  improves: improvesDraftConfigSchema.partial().optional(),
  stepTimer: stepTimerDraftConfigSchema.partial().optional(),
  timeProgress: timeProgressDraftConfigSchema.partial().optional(),
  poll: pollDraftConfigSchema.partial().optional(),
  mythFact: mythFactDraftConfigSchema.partial().optional(),
  versus: versusDraftConfigSchema.partial().optional(),
  priceReveal: priceRevealDraftConfigSchema.partial().optional(),
  clientQuestion: clientQuestionDraftConfigSchema.partial().optional(),
  comeWithMe: comeWithMeDraftConfigSchema.partial().optional(),
});

export type PartialDraftConfig = z.infer<typeof partialDraftConfigSchema>;

/**
 * `POST videos` body — the EXTENDABLE half.
 *
 * ONE endpoint, TWO shapes, discriminated by sniffing rather than a version
 * tag — which is exactly why it needs a single written-down contract:
 *
 *  1. PARTIAL (`{ format }` or `{ templateId }`) — the server synthesises the
 *     whole `draftConfig` from org defaults + the template definition + the
 *     optional service. Anything the caller does send merges OVER those
 *     defaults (caller wins).
 *  2. COMPLETE — a `draftConfig` carrying all of `bRollClips`, `captions`,
 *     `outro` and `orientation` is taken verbatim, and `title` becomes
 *     REQUIRED (the service 400s without it). That conditional requirement is
 *     enforced in the service, not here, because it depends on the contents of
 *     a nested object.
 *
 * `draftConfig` is {@link partialDraftConfigSchema} — every key optional, so
 * either shape parses. It is NOT `z.record(z.unknown())`: the client validating
 * the same nested rules the server does is the whole point.
 *
 * `usageType` marks the video as destined for a paid AD or an ORGANIC social
 * post, and `createVideo` persists it (defaulting to `ad`). It had been MISSING
 * from the API's hand-written DTO, so every organic video created from the
 * socials generate dialogs — which set `usageType: 'organic'` explicitly — was
 * silently stored as an ad. Restoring it here is a behaviour change on the
 * complete-draftConfig branch, where the field now reaches `createVideo`.
 *
 * Context fields the SERVER injects, absent here:
 *  - `organizationId` — from the active-org session.
 *  - `createdById`    — the authenticated user.
 */
export const createVideoRequestBase = z.object({
  /** Optional. Auto-derived from service name / template title if omitted. */
  title: z.string().min(1).max(100).optional(),
  /** Backend template ID (`before-after`, `authority`, …). */
  templateId: z.string().optional(),
  /** LLM-facing format alias (`before_after`, `authority`, …). */
  format: z.string().optional(),
  /** Specific variation; defaults to a random pick within the template. */
  variationId: z.string().optional(),
  /** Optional link to an organization service this video is about. */
  serviceId: z.string().optional(),
  /** Optional link to an offer used in this video (offer templates). */
  offerId: z.string().optional(),
  /** Partial overrides merged over the synthesised defaults — caller wins. */
  draftConfig: partialDraftConfigSchema.optional(),
  /** Paid ad vs organic social post. Persisted; defaults to `ad`. */
  usageType: z.enum(['ad', 'organic']).optional(),
});

/** `POST videos` body — the VALIDATING half. */
export const createVideoRequestSchema = createVideoRequestBase.strict();

export type CreateVideoRequest = z.infer<typeof createVideoRequestSchema>;

/**
 * `PUT videos/:id` body — the EXTENDABLE half.
 *
 * A PATCH: absent means "leave unchanged". `title` is `.min(1).optional()` —
 * omit it, but do not blank it. `serviceId` / `offerId` are nullable because
 * DETACHING them is a real edit the wizard performs.
 *
 * `draftConfig` here is `draftConfigSchema.partial()` — a SHALLOW partial,
 * unlike the deep-merged {@link patchVideoDraftConfigRequestBase}. Sending
 * `draftConfig: { captions: {…} }` REPLACES the captions object wholesale, so
 * every key of `captions` must be present. That is the trap this endpoint sets,
 * and it is why the chat-driven edits use `PATCH :id/draft-config` instead.
 *
 * `status` is client-settable including `queued` / `processing` / `ready` /
 * `failed` because the video WIZARD drives the render state machine from the
 * browser (unlike social posts, where publication is worker-owned).
 *
 * `blobUrl` / `thumbnailUrl` are `.url()`-validated, so a surface holding an
 * as-yet-unresolved URL must send `undefined`, not `''`.
 *
 * Context fields the SERVER injects, absent here:
 *  - `id` — the `:id` route param.
 */
export const updateVideoRequestBase = z.object({
  title: z.string().min(1).max(100).optional(),
  /** `null` detaches the service. */
  serviceId: z.string().nullable().optional(),
  /** `null` detaches the offer. */
  offerId: z.string().nullable().optional(),
  status: z
    .enum(['draft', 'queued', 'processing', 'ready', 'failed'])
    .optional(),
  progress: z.number().min(0).max(100).optional(),
  errorMessage: z.string().optional(),
  /** SHALLOW partial — a nested object you send REPLACES the stored one. */
  draftConfig: draftConfigSchema.partial().optional(),
  blobUrl: z.string().url().optional(),
  thumbnailUrl: z.string().url().optional(),
  durationMs: z.number().optional(),
});

/** `PUT videos/:id` body — the VALIDATING half. */
export const updateVideoRequestSchema = updateVideoRequestBase.strict();

export type UpdateVideoRequest = z.infer<typeof updateVideoRequestSchema>;

/**
 * `PATCH videos/:id/draft-config` body — the EXTENDABLE half.
 *
 * The narrow, DEEP-MERGED twin of `PUT videos/:id`: the `patch` object is
 * merged key-by-key onto the stored config, so `{ patch: { offerCard: {
 * headline } } }` edits one line of the offer card without resending
 * `serviceName` / `ctaText`. That is what makes it the surface both the
 * iterate-in-chat flow and the b-roll clip strip write through, and it is the
 * reason `partialDraftConfigSchema` (with its ALSO-partial `offerCard`) is the
 * right shape here where `draftConfigSchema.partial()` is not.
 *
 * `requeueRender` DEFAULTS TO TRUE — the point of the chat flow is "iterate by
 * talking", so a patch normally re-renders. Like every `.default()` on a
 * contract it MATERIALISES into the parsed body. Callers for whom a patch is an
 * edit rather than a render request (the clip strip, where a user may drop a
 * still-processing clip) must send `false` EXPLICITLY.
 *
 * Context the SERVER injects, absent here:
 *  - `videoId`          — the `:id` route param.
 *  - `organizationId`   — from the active-org session.
 *  - `whatsappDelivery` — from the `@WhatsappDelivery()` request decorator, so
 *    a Claire-on-WhatsApp edit pushes the re-render back to the conversation.
 *    It is NOT a body field; a client cannot address someone else's chat.
 */
/**
 * Where a clip operation lands. Exactly one of `index` / `targetAssetId`.
 *
 * `index` is what a human means ("the second clip") and the only way to name
 * one occurrence when the planner has cycled a service's clips and the same
 * asset appears twice. `targetAssetId` is what a model can name without a read
 * of the array — and Claire has none, because `videos_listDraftClips` returns
 * the `video_draft_clip` tray, a different representation from the
 * `bRollClips` the renderer consumes.
 */
const clipAddressFields = {
  index: z.number().int().min(0).optional(),
  targetAssetId: z.string().min(1).optional(),
};

const exactlyOneAddress = (
  value: { index?: number; targetAssetId?: string },
  ctx: z.RefinementCtx
) => {
  const named = [value.index !== undefined, Boolean(value.targetAssetId)];
  if (named.filter(Boolean).length !== 1) {
    ctx.addIssue({
      code: 'custom',
      message: 'Name the clip by exactly one of `index` or `targetAssetId`.',
    });
  }
};

/**
 * A NAMED edit to the clip list, applied server-side against the stored array.
 *
 * These exist because `patch.bRollClips` replaces the array WHOLESALE. A caller
 * holding a partial view of the list — which Claire always is — could only
 * change one clip by resending every clip, so everything she could not see was
 * dropped. The render succeeded and nothing reported it.
 *
 * `swap` and `remove` touch exactly one position and copy the rest through
 * untouched. `patch.bRollClips` still works and is still a wholesale replace;
 * the difference is that it now has to be ASKED for rather than arrived at.
 */
export const clipOperationSchema = z.union([
  z
    .object({
      op: z.literal('swap'),
      /** The asset to put at the named position. */
      assetId: z.string().min(1),
      ...clipAddressFields,
    })
    .superRefine(exactlyOneAddress),
  z
    .object({ op: z.literal('remove'), ...clipAddressFields })
    .superRefine(exactlyOneAddress),
]);

export type ClipOperationRequest = z.infer<typeof clipOperationSchema>;

export const patchVideoDraftConfigRequestBase = z.object({
  /** Deep-merged over the existing config; nested `offerCard` is partial too. */
  patch: partialDraftConfigSchema.optional().default({}),
  /**
   * Named clip edits, applied to the STORED clip list before `patch` merges.
   *
   * Ordered before the declarative patch so a caller sending both gets the
   * predictable reading: operations edit what is stored, then the patch has
   * the final word. A `patch.bRollClips` alongside operations therefore wins,
   * which is the correct precedence for an explicit wholesale replace.
   */
  clipOperations: z.array(clipOperationSchema).max(20).optional(),
  /** Title patch, separate from the draft config. */
  title: z.string().min(1).max(100).optional(),
  /** Defaults TRUE — send `false` explicitly to edit without re-rendering. */
  requeueRender: z.boolean().optional().default(true),
});

/**
 * `PATCH videos/:id/draft-config` body — the VALIDATING half.
 *
 * A body that changes NOTHING is rejected. `patch` is no longer required as a
 * key — `clipOperations` is now an equally valid way to change the draft, and
 * forcing a clip-only edit to carry `patch: {}` would be ceremony. The guard is
 * therefore on emptiness rather than on presence, which is what the rule always
 * meant: an empty body patches nothing, and silently succeeding at it tells the
 * caller an edit landed when none did.
 */
export const patchVideoDraftConfigRequestSchema =
  patchVideoDraftConfigRequestBase.strict().superRefine((value, ctx) => {
    const patchesConfig = Object.keys(value.patch ?? {}).length > 0;
    const editsClips = (value.clipOperations?.length ?? 0) > 0;
    if (!patchesConfig && !editsClips && value.title === undefined) {
      ctx.addIssue({
        code: 'custom',
        message:
          'Send at least one of `patch`, `clipOperations` or `title` — an empty body patches nothing.',
      });
    }
  });

export type PatchVideoDraftConfigRequest = z.infer<
  typeof patchVideoDraftConfigRequestSchema
>;

// ── Content batches ───────────────────────────────────────────────────────

/**
 * `POST content-batches/items/:itemId/accept` body — the EXTENDABLE half.
 *
 * Every field is a REVIEW-TIME OVERRIDE. The planner already seeded `caption`,
 * `scheduledAt` and `targetPageIds` onto the batch item; the review dialog lets
 * the user edit them before accepting, and anything omitted falls back to the
 * stored value. That fallback is why `scheduledAt: null` and `scheduledAt`
 * absent mean DIFFERENT things: `null` drafts the post, absent keeps whatever
 * the planner scheduled.
 */
export const acceptBatchItemRequestBase = z.object({
  /** Edited caption for the scheduled post. */
  caption: z.string().optional(),
  /** `null` → draft the post instead of scheduling it. */
  scheduledAt: z.coerce.date().optional().nullable(),
  /** Meta page ids to post to (platforms derived from them). */
  targetPageIds: z.array(z.string().min(1)).optional(),
});

/** `POST content-batches/items/:itemId/accept` body — the VALIDATING half. */
export const acceptBatchItemRequestSchema = acceptBatchItemRequestBase.strict();

export type AcceptBatchItemRequest = z.infer<
  typeof acceptBatchItemRequestSchema
>;
