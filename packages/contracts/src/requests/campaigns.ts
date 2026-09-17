/**
 * messaging-campaigns request CONTRACTS — the canonical, strict Zod schema for
 * the BODY of each campaign / segment write endpoint.
 *
 * (This is the BULK-MESSAGING campaigns feature — `packages/features/src/
 * campaigns` — not the Meta Ads campaigns feature, which is a different domain
 * that happens to share the word.)
 *
 * DIRECTION OF DERIVATION — wire -> server
 * ---------------------------------------
 * This file is the SOURCE. Each feature schema under
 * `packages/features/src/campaigns/services/<action>-<entity>/` DERIVES from it
 * by `.extend()`ing the server-injected context fields onto the base:
 *
 *     createCampaignSchema = createCampaignRequestBase.extend({
 *       organizationId, createdById,
 *     })
 *
 * Because the server schema literally IS the wire schema plus fields, it can
 * never be laxer than the wire schema, and no drift is possible. Do NOT invert
 * this — a contract hand-copied from the feature schema is exactly the drift
 * this package exists to eliminate.
 *
 * BASE vs SCHEMA — why two exports
 * --------------------------------
 *  - `<name>RequestBase`   — a plain `z.object({…})`. EXTENDABLE. This is what
 *    the backend feature schema extends with its context fields. It is NOT
 *    strict, because `.strict()` would reject the very fields being added.
 *  - `<name>RequestSchema` — `<name>RequestBase.strict()`. This is what
 *    VALIDATES a wire body: unknown fields are REJECTED, so a client sending a
 *    stale, renamed, or typo'd key fails loudly instead of having it silently
 *    stripped by a permissive `z.object`.
 *
 * Context fields the SERVER injects are absent from every body contract here:
 *  - `organizationId` — from the active-org session, never sent by the client.
 *  - `createdById`    — from the authenticated user, never sent by the client.
 *  - `id` / `campaignId` — route params (`PUT campaigns/:id`), never in a body.
 */
import {
  campaignChannelValues,
  campaignTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * The channel vocabulary a campaign can send through, sourced from the shared
 * labels package so the wire enum, the pgEnum and the UI dropdown can never
 * disagree. Re-exported by the feature package as `campaignChannelZ` (its
 * historical name) so existing imports keep working.
 */
export const campaignChannelRequestZ = z.enum(campaignChannelValues);

// ── Segments ──────────────────────────────────────────────────────────────

/**
 * The persisted audience-filter shape (stored as `segment.filterJson`) as it
 * appears on the wire. Kept in one place so create / update / preview all
 * validate identically, and so the composer's segment-builder cannot assemble a
 * filter the server would reject.
 *
 * `.strict()` here is deliberate and load-bearing: a filter key the backend does
 * not understand would otherwise be persisted and silently ignored at send
 * time, quietly widening the audience of a bulk message. Better a 400.
 *
 * All four date bounds are `.datetime()` ISO strings, NOT `Date`s — this is the
 * wire.
 */
export const segmentFilterRequestSchema = z
  .object({
    status: z.array(z.string()).optional(),
    source: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    search: z.string().optional(),
    consentEmail: z.boolean().optional(),
    consentSms: z.boolean().optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    lastContactedBefore: z.string().datetime().optional(),
    lastContactedAfter: z.string().datetime().optional(),
  })
  .strict();

/**
 * `POST campaigns/segments` body — the EXTENDABLE half.
 *
 * `isDynamic` carries `.default(true)`: a segment re-evaluates its filter at
 * send time unless the caller explicitly freezes it. Note that `.default()`
 * MATERIALISES — `createSegmentRequestSchema.parse({ name, filterJson })` emits
 * `isDynamic: true`, so a client that previously omitted the key now sends it.
 * The value is identical to what the server would have applied; do not delete
 * the default to avoid that, because the feature schema IS this base and
 * removing it would change SERVER behaviour.
 */
export const createSegmentRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
  filterJson: segmentFilterRequestSchema,
  isDynamic: z.boolean().default(true),
});

/** `POST campaigns/segments` body — the VALIDATING half. */
export const createSegmentRequestSchema = createSegmentRequestBase.strict();

export type CreateSegmentRequest = z.infer<typeof createSegmentRequestSchema>;

/**
 * `PUT campaigns/segments/:id` body — the EXTENDABLE half. Every field is
 * optional (a partial update); `id` is the route param, not a body field.
 *
 * Note `isDynamic` has NO default here, unlike create: absent means "leave the
 * stored value alone", which is not the same as "make it dynamic".
 */
export const updateSegmentRequestBase = z.object({
  name: z.string().min(1).optional(),
  filterJson: segmentFilterRequestSchema.optional(),
  isDynamic: z.boolean().optional(),
});

/** `PUT campaigns/segments/:id` body — the VALIDATING half. */
export const updateSegmentRequestSchema = updateSegmentRequestBase.strict();

export type UpdateSegmentRequest = z.infer<typeof updateSegmentRequestSchema>;

/**
 * `POST campaigns/segments/preview` body — the EXTENDABLE half.
 *
 * A read-shaped POST (the filter is too big for a query string). `channels`
 * defaults to ALL channels, so an omitted key means "how many leads can I reach
 * on anything", which is the reach number the composer shows before a send.
 */
export const previewSegmentRequestBase = z.object({
  filterJson: segmentFilterRequestSchema,
  channels: z.array(campaignChannelRequestZ).default(campaignChannelValues),
});

/** `POST campaigns/segments/preview` body — the VALIDATING half. */
export const previewSegmentRequestSchema = previewSegmentRequestBase.strict();

export type PreviewSegmentRequest = z.infer<typeof previewSegmentRequestSchema>;

// ── Campaigns ─────────────────────────────────────────────────────────────

/**
 * `POST campaigns` body — the EXTENDABLE half.
 *
 * `type` carries `.default('custom')`, which MATERIALISES into the parsed body
 * (see the note on `createSegmentRequestBase`).
 *
 * `channels` is `.min(1)`: a campaign with no channel would be created,
 * launched, and deliver nothing — a silent no-op is the worst possible outcome
 * for a bulk send, so it is a 400 instead.
 *
 * `scheduledAt` is an ISO `.datetime()` string, NOT a `Date` and NOT a loose
 * string. The frontend builder previously accepted any string here and let the
 * server 400; that check now fires client-side, which is the point.
 */
export const createCampaignRequestBase = z.object({
  name: z.string().min(1, 'Name is required'),
  type: z.enum(campaignTypeValues).default('custom'),
  channels: z
    .array(campaignChannelRequestZ)
    .min(1, 'Pick at least one channel'),
  segmentId: z.string().optional(),
  scheduledAt: z.string().datetime().optional(),
});

/** `POST campaigns` body — the VALIDATING half. */
export const createCampaignRequestSchema = createCampaignRequestBase.strict();

export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

/**
 * `PUT campaigns/:id` body — the EXTENDABLE half.
 *
 * `segmentId` and `scheduledAt` are `.nullable().optional()`, and the
 * distinction matters: ABSENT means "don't touch", `null` means "clear it"
 * (detach the audience / unschedule). `type` is deliberately NOT updatable — a
 * campaign's preset is fixed at creation.
 */
export const updateCampaignRequestBase = z.object({
  name: z.string().min(1).optional(),
  channels: z.array(campaignChannelRequestZ).min(1).optional(),
  segmentId: z.string().nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
});

/** `PUT campaigns/:id` body — the VALIDATING half. */
export const updateCampaignRequestSchema = updateCampaignRequestBase.strict();

export type UpdateCampaignRequest = z.infer<typeof updateCampaignRequestSchema>;

/**
 * `POST campaigns/:id/launch` body (and its `:id/resume` / `:id/cancel`
 * siblings) — the EXTENDABLE half.
 *
 * These endpoints take NO body: everything they need is the route param plus
 * the session's org. Pinning that as an explicit, EMPTY, strict object is not
 * ceremony — it is what makes "send this campaign to everyone" refuse a stray
 * `{ segmentId }` or `{ testMode: true }` that a caller assumed was honoured.
 * A silently-ignored field on the one irreversible endpoint in this feature is
 * exactly the failure mode worth a 400.
 */
export const launchCampaignRequestBase = z.object({});

/** `POST campaigns/:id/launch` body — the VALIDATING half. */
export const launchCampaignRequestSchema = launchCampaignRequestBase.strict();

export type LaunchCampaignRequest = z.infer<typeof launchCampaignRequestSchema>;

// ── Campaign messages ─────────────────────────────────────────────────────

/**
 * `POST campaigns/:id/messages` body — the EXTENDABLE half.
 *
 * UPSERT semantics: one message per campaign per channel, so posting the same
 * `channel` twice edits rather than appends. That is why `channel` is required
 * while everything else is per-channel dressing.
 *
 * `subject` is meaningful ONLY on the `email` channel. It is `.optional()`
 * rather than conditionally required because the rule lives in the frontend
 * builder (which omits it entirely for every other channel) and the send path
 * simply never reads it off an SMS/WhatsApp row — encoding it as a cross-field
 * `.refine()` would make the base un-`.extend()`able for no gain.
 *
 * `whatsappTemplateParams` are the ordered `{{1}}..{{n}}` values for an
 * approved WhatsApp template. Entries may themselves contain campaign merge
 * tags (`{{firstName|there}}`) which are interpolated per-lead at send time —
 * so a param is a TEMPLATE, not a literal. The `.max(20)` mirrors Meta's own
 * ceiling; exceeding it fails at Meta, far too late to be useful, so it fails
 * here instead.
 *
 * `mediaUrl` is `.url()`-validated, which is the pair that bites: a media
 * picker whose empty value is `''` must normalise it to `undefined` before
 * building the body.
 *
 * Context fields the SERVER injects, absent here:
 *  - `campaignId`     — the `:id` route param.
 *  - `organizationId` — from the active-org session.
 */
export const upsertCampaignMessageRequestBase = z.object({
  channel: campaignChannelRequestZ,
  /** Email only — omitted entirely on every other channel. */
  subject: z.string().optional(),
  body: z.string().min(1, 'Message body is required'),
  whatsappTemplateId: z.string().optional(),
  /** Ordered `{{1}}..{{n}}` values; each may itself contain merge tags. */
  whatsappTemplateParams: z.array(z.string()).max(20).optional(),
  mediaUrl: z.string().url().optional(),
});

/** `POST campaigns/:id/messages` body — the VALIDATING half. */
export const upsertCampaignMessageRequestSchema =
  upsertCampaignMessageRequestBase.strict();

export type UpsertCampaignMessageRequest = z.infer<
  typeof upsertCampaignMessageRequestSchema
>;
