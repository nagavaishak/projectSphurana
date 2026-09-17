import {
  assistantActionTypeValues,
  commitmentLevelValues,
  marketPositionValues,
  offerStrategyValues,
  retentionModelValues,
} from '@borradh-workspace/labels';
/**
 * Conversations / chatbots / Claire / assistant response PROJECTIONS —
 * hand-composed from generated atoms. Follows the pattern in ./leads.ts and
 * ./sales.ts.
 *
 * Covers four related surfaces:
 *  - conversations  — the omni-channel inbox (Messenger / IG / WhatsApp).
 *  - chatbots       — reuses the conversation inbox shapes (no own entities).
 *  - claire         — recommendation engine + business-profile classifier.
 *  - assistant      — the "Ask AI" conversation surface.
 *
 * Gotchas applied (see the wave-1 notes):
 *  1. `$type<>()` text/jsonb columns widen to `z.string()` / `z.unknown()` in the
 *     atom. They are hand-narrowed here to stay assignable to the api-client
 *     type: message/conversation `metadata`, message `origin`, assistant
 *     `channel`, recommendation `primaryAction`, business-profile jsonb.
 *  2. List wrappers echo the api-client shape exactly — `ListMessagesResponse`
 *     has NO `total`; the conversation list wrapper does.
 *
 * Distinctive projection names (barrel is one namespace): everything is prefixed
 * to avoid colliding with other domains' `Message` / `Conversation`.
 */
import { z } from 'zod';
import {
  assistantConversationAtomSchema,
  assistantMessageAtomSchema,
  assistantRecommendationAtomSchema,
  businessProfileAtomSchema,
  conversationAtomSchema,
  conversationMessageAtomSchema,
  organizationAtomSchema,
  organizationServiceAtomSchema,
} from '../generated/index.js';

// ============================================================================
// CONVERSATIONS — inbox entities
// ============================================================================

/**
 * Loosely-shaped conversation `metadata`. The DB column is typed
 * (`$type<ConversationMetadata>`) but has an open `[key: string]: unknown` index
 * signature and all-optional named fields, so a `Record<string, unknown>`
 * projection is assignable to the api-client type without re-listing 40 fields.
 */
const conversationMetadataSchema = z.record(z.string(), z.unknown());

/**
 * A conversation (inbox thread) as returned by get/assign/close. The atom with
 * `metadata` narrowed from `unknown` to a record so it matches the api-client
 * `Conversation` type.
 */
export const conversationSchema = conversationAtomSchema.extend({
  metadata: conversationMetadataSchema.nullable(),
});
export type ConversationResponse = z.infer<typeof conversationSchema>;

/**
 * A single message in a conversation. `origin` is a typed text column
 * (`$type<'live' | 'sync' | 'backfill'>`) widened to `z.string()` by the
 * generator; narrowed back here. `metadata` narrowed to a record.
 */
export const conversationMessageSchema = conversationMessageAtomSchema.extend({
  origin: z.enum(['live', 'sync', 'backfill']),
  metadata: z.record(z.string(), z.unknown()).nullable(),
});
export type ConversationMessageResponse = z.infer<
  typeof conversationMessageSchema
>;

/**
 * A conversation list row — the conversation plus the joined last-message
 * preview fields (computed, not columns).
 */
export const conversationListItemSchema = conversationSchema.extend({
  lastMessageContent: z.string().nullable(),
  lastMessageRole: z.string().nullable(),
});
export type ConversationListItemResponse = z.infer<
  typeof conversationListItemSchema
>;

/** `GET /conversations` — `{ items, total, limit, offset }` list wrapper. */
export const listConversationsResponseSchema = z.object({
  items: z.array(conversationListItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
});
export type ListConversationsResponse = z.infer<
  typeof listConversationsResponseSchema
>;

/**
 * `GET /conversations/:id/messages` — the message list wrapper. Note there is NO
 * `total` field on this endpoint (matches the api-client `ListMessagesResponse`).
 */
export const listMessagesResponseSchema = z.object({
  items: z.array(conversationMessageSchema),
  limit: z.number(),
  offset: z.number(),
});
export type ListMessagesResponse = z.infer<typeof listMessagesResponseSchema>;

/** `POST /conversations/sync` — the Meta backfill sync result summary. */
export const syncConversationsResponseSchema = z.object({
  synced: z.number(),
  errors: z.number(),
});
export type SyncConversationsResponse = z.infer<
  typeof syncConversationsResponseSchema
>;

// ============================================================================
// CLAIRE — recommendation engine
// ============================================================================

/**
 * The discriminated primary-action carried on every recommendation. The DB
 * column is `$type<AssistantPrimaryAction>` (widened to `unknown` in the atom);
 * reproduced here so the inferred type stays assignable.
 */
export const assistantPrimaryActionSchema = z.object({
  label: z.string(),
  type: z.enum(assistantActionTypeValues),
  target: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});
export type AssistantPrimaryActionResponse = z.infer<
  typeof assistantPrimaryActionSchema
>;

/**
 * A recommendation row as returned by `GET /claire/recommendations`. Narrows the
 * widened `primaryAction` (required) and `metadata` (open record) jsonb columns.
 */
export const assistantRecommendationSchema =
  assistantRecommendationAtomSchema.extend({
    primaryAction: assistantPrimaryActionSchema,
    metadata: z.record(z.string(), z.unknown()).nullable(),
  });
export type AssistantRecommendationResponse = z.infer<
  typeof assistantRecommendationSchema
>;

/** `GET /claire/recommendations` — a bare array of active recommendations. */
export const listRecommendationsResponseSchema = z.array(
  assistantRecommendationSchema
);
export type ListRecommendationsResponse = z.infer<
  typeof listRecommendationsResponseSchema
>;

// ============================================================================
// CLAIRE — business-profile classifier (jsonb shapes reproduced from the table)
// ============================================================================

/** A ranked service recommendation stored on `business_profile.ranked_services`. */
export const rankedServiceSchema = z.object({
  serviceId: z.string(),
  rank: z.number(),
  score: z.number(),
  criteriaScores: z.object({
    retentionFit: z.number(),
    barrierToEntry: z.number(),
    crossSell: z.number(),
    complianceRisk: z.number(),
  }),
  marketPosition: z.enum(marketPositionValues),
  ownerEstimatedCompetitorPrice: z.number().optional(),
  offerStrategy: z.enum(offerStrategyValues),
  suggestedIntroPrice: z.number().optional(),
  offerStrategyReason: z.string(),
  serviceRecommendationCopy: z.object({ title: z.string(), body: z.string() }),
  offerRecommendationCopy: z.object({ title: z.string(), body: z.string() }),
  objections: z.array(
    z.object({ id: z.string(), trigger: z.string(), response: z.string() })
  ),
});
export type RankedServiceResponse = z.infer<typeof rankedServiceSchema>;

/** The classifier's 3-axis output, with confidence + reasoning. */
export const classifierAxesSchema = z.object({
  retentionModel: z.enum(retentionModelValues),
  commitmentLevel: z.enum(commitmentLevelValues),
  marketPosition: z.enum(marketPositionValues),
  confidence: z.number(),
  reasoning: z.string(),
});

/** Owner overrides applied on top of the classifier axes. */
export const overriddenAxesSchema = z.object({
  retentionModel: z.enum(retentionModelValues).optional(),
  commitmentLevel: z.enum(commitmentLevelValues).optional(),
  marketPosition: z.enum(marketPositionValues).optional(),
  overriddenAt: z.string(),
  overriddenBy: z.string(),
});

/** A surfaced classifier/owner disagreement and its resolution state. */
export const disagreementSchema = z.object({
  axes: z.array(
    z.enum(['retentionModel', 'commitmentLevel', 'marketPosition'])
  ),
  classifierConfidence: z.number(),
  surfaced: z.boolean(),
  surfacedAt: z.string().nullable(),
  resolution: z.enum(['pending', 'owner_held', 'owner_changed', 'ignored']),
});
export type DisagreementResponse = z.infer<typeof disagreementSchema>;

/**
 * The business-profile row as returned by the Claire axis mutations
 * (`POST /claire/override-axes`, `/set-market-position`, `/resolve-disagreement`).
 * All five jsonb columns narrowed from `unknown` to their table shapes.
 */
export const businessProfileSchema = businessProfileAtomSchema.extend({
  classifierAxes: classifierAxesSchema.nullable(),
  overriddenAxes: overriddenAxesSchema.nullable(),
  disagreement: disagreementSchema.nullable(),
  rankedServices: z.array(rankedServiceSchema),
  verticalMetadata: z.record(z.string(), z.unknown()),
});
export type BusinessProfileResponse = z.infer<typeof businessProfileSchema>;

// ============================================================================
// CLAIRE — ad-creation context (fully computed; no backing table)
// ============================================================================

export const adCreationContextServiceSchema = z.object({
  serviceId: z.string(),
  title: z.string(),
  body: z.string(),
  reasoning: z.string(),
  objections: rankedServiceSchema.shape.objections,
});

export const adCreationContextOfferSchema = z.object({
  strategy: z.enum(offerStrategyValues),
  suggestedIntroPrice: z.number().optional(),
  title: z.string(),
  body: z.string(),
  reasoning: z.string(),
});

export const adCreationContextAlternativeSchema = z.object({
  serviceId: z.string(),
  rank: z.number(),
  title: z.string(),
});

/** `GET /claire/ad-creation-context` — the /ads/new advisor payload. */
export const adCreationContextResponseSchema = z.object({
  service: adCreationContextServiceSchema.nullable(),
  offer: adCreationContextOfferSchema.nullable(),
  alternatives: z.array(adCreationContextAlternativeSchema),
  profileState: z.enum(['fresh', 'pending', 'missing']),
  needsMarketPosition: z.boolean(),
  disagreement: disagreementSchema.nullable(),
});
export type AdCreationContextResponse = z.infer<
  typeof adCreationContextResponseSchema
>;

// ============================================================================
// ASSISTANT — "Ask AI" conversation surface
// ============================================================================

/**
 * An assistant conversation. `channel` is a typed text column
 * (`$type<'web' | 'whatsapp'>`) widened to `z.string()`; narrowed back.
 * `pendingConfirmation` is a required-field jsonb narrowed from `unknown`.
 */
export const assistantConversationSchema =
  assistantConversationAtomSchema.extend({
    channel: z.enum(['web', 'whatsapp']),
    pendingConfirmation: z
      .object({ kind: z.string(), draftId: z.string() })
      .nullable(),
  });
export type AssistantConversationResponse = z.infer<
  typeof assistantConversationSchema
>;

/**
 * An assistant message. `toolCalls` / `toolResults` / `attachments` are UNtyped
 * jsonb (backend type `unknown`), so the atom is verbatim — no narrowing needed.
 */
export const assistantMessageSchema = assistantMessageAtomSchema;
export type AssistantMessageResponse = z.infer<typeof assistantMessageSchema>;

/**
 * `GET /assistant/conversations/:id` — a conversation with its full message list.
 */
export const assistantConversationWithMessagesSchema =
  assistantConversationSchema.extend({
    messages: z.array(assistantMessageSchema),
  });
export type AssistantConversationWithMessagesResponse = z.infer<
  typeof assistantConversationWithMessagesSchema
>;

/**
 * `GET /assistant/context` — the organization profile Claire loads for tone and
 * service grounding.
 *
 * Computed by `getAssistantContext`, which reads a NARROW `columns:` selection
 * off `organization` plus a five-column select over `organization_service`, and
 * adds one derived field (`businessTypeLabel`). Every column is `.pick()`ed
 * from its atom so a rename breaks the build; the two jsonb `string[]` columns
 * (`brandVoice`, `painPoints`, `expectedResults`) are narrowed from the atoms'
 * `unknown` to what the service actually casts them to.
 *
 * Note what is NOT here: there is no `organizationName`, no `toneRegion` and no
 * `brandKit` on this endpoint, and `brandVoice` is an ARRAY, not a string.
 */
export const assistantContextServiceDetailSchema = organizationServiceAtomSchema
  .pick({
    name: true,
    processDescription: true,
    targetArea: true,
  })
  .extend({
    painPoints: z.array(z.string()).nullable(),
    expectedResults: z.array(z.string()).nullable(),
  });
export type AssistantContextServiceDetail = z.infer<
  typeof assistantContextServiceDetailSchema
>;

export const assistantContextResponseSchema = organizationAtomSchema
  .pick({
    name: true,
    address: true,
    businessType: true,
    targetAudienceDescription: true,
    credibilityLine: true,
    tagline: true,
  })
  .extend({
    /** Derived from `businessTypeLabels`, falling back to the raw enum value. */
    businessTypeLabel: z.string(),
    brandVoice: z.array(z.string()),
    services: z.array(z.string()),
    serviceDetails: z.array(assistantContextServiceDetailSchema),
  });
export type AssistantContextResponse = z.infer<
  typeof assistantContextResponseSchema
>;

/** `GET /assistant/conversations` — `{ conversations }` wrapper (no pagination). */
export const listAssistantConversationsResponseSchema = z.object({
  conversations: z.array(assistantConversationSchema),
});
export type ListAssistantConversationsResponse = z.infer<
  typeof listAssistantConversationsResponseSchema
>;
