import { z } from 'zod';

/**
 * Cycle kind — keyed off `assistantRecommendation.kind` (Window 1 added
 * `ad_flow_service_pick` + `ad_flow_offer_pick` for exactly this use).
 *
 * One push-memory row per (organization, conversation, kind). The row's
 * lifecycle (active → actioned/dismissed/expired) defines the cycle: while
 * active, Claire should NOT re-push the top pick in chat.
 */
export const claireCycleKindValues = [
  'ad_flow_service_pick',
  'ad_flow_offer_pick',
] as const;

export type ClaireCycleKind = (typeof claireCycleKindValues)[number];

export const hasPushedTopPickSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(claireCycleKindValues),
});

export type HasPushedTopPickInput = z.infer<typeof hasPushedTopPickSchema>;

export const markTopPickPushedSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(claireCycleKindValues),
  rankedServiceId: z.string().min(1),
  // Optional pointer to the draft this cycle controls. Populated when the
  // draft has been created by a set_pending_* tool; the recommend_* tools
  // mark a cycle without a draftId because the user hasn't committed yet.
  draftId: z.string().min(1).optional(),
});

export type MarkTopPickPushedInput = z.infer<typeof markTopPickPushedSchema>;

/**
 * Cycle metadata shape — persisted on `assistant_recommendation.metadata`.
 *
 * `impressionAt` is set when the cycle is opened (first push). It powers the
 * `secondsFromImpression` property on `claire.recommendation.published`.
 * `acceptedAtRank` is set when a `set_pending_*_service` tool fires with a
 * service that matches one of the ranked services from the recommendation.
 *
 * Typed as a record (not an interface) so it satisfies Drizzle's
 * `jsonb().$type<Record<string, unknown>>()` constraint without an explicit
 * cast at every insert/update call site.
 */
export type ClaireCycleMetadata = {
  surface: 'chat';
  conversationId: string;
  rankedServiceId?: string;
  draftId?: string;
  impressionAt?: string;
  acceptedAtRank?: number;
} & Record<string, unknown>;

export const setDraftPointerSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(claireCycleKindValues),
  draftId: z.string().min(1),
});

export type SetDraftPointerInput = z.infer<typeof setDraftPointerSchema>;

export const getCurrentCycleSchema = z.object({
  organizationId: z.string().min(1),
  conversationId: z.string().min(1),
  kind: z.enum(claireCycleKindValues),
});

export type GetCurrentCycleInput = z.infer<typeof getCurrentCycleSchema>;
