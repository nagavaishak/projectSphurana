/**
 * Content generation provenance — why a piece of content looks the way it does.
 *
 * WHY THIS EXISTS
 * ---------------
 * The recurring content complaints ("wrong image for the service", "same photo
 * again", "our logo isn't on it") were untraceable: the graphic worker emitted
 * no decision logs at all, and nothing recorded which asset was chosen, what
 * else was considered, or whether the brand logo was even available. A prod
 * audit could measure the *symptoms* (16 graphics generated from 2 eligible
 * images for one service) but never the *decision* behind any single piece.
 *
 * Every row here is one selection decision, written at the point the choice is
 * made. Two jobs:
 *
 *   1. DIAGNOSIS — turn "this graphic used the wrong photo" from a report you
 *      cannot action into a row you can query, with the rejected candidates
 *      and the reason each was passed over.
 *   2. ROTATION — `chosenAssetId` + `serviceId` is the usage history that lets
 *      selection prefer an asset it has NOT recently used. Deterministic
 *      "newest asset first" is why one service produced sixteen graphics of
 *      the same two photos.
 *
 * Deliberately append-only and side-effect free: writing provenance must never
 * fail a render. Callers record best-effort and ignore errors.
 */

import { relations } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { orgRlsPolicy } from '../rls-policy.js';
import { asset } from './asset.js';
import { organizationService } from './organization-service.js';
import { organization } from './organization.js';

/** What the provenance row describes. */
export const provenanceSubjectEnum = pgEnum('provenance_subject', [
  'graphic',
  'video',
]);

/**
 * Where the chosen visual came from.
 *
 * `stock` and `none` are first-class outcomes, not failures: with 91% of
 * active services having no footage of their own, falling back is the expected
 * path, and we want to be able to measure how often it happens.
 */
export const provenanceMediaSourceEnum = pgEnum('provenance_media_source', [
  'service-video-thumbnail',
  'service-image-asset',
  'owner-selected',
  'stock',
  'ai-generated',
  'none',
]);

/**
 * Whether the org's real logo reached the image model.
 *
 * A prod audit found 35% of orgs have no logo on file, and `ensureLogoVariants`
 * returned empty for them with NO log line at all — so "the logo keeps
 * changing" was invisible. `missing-no-logo` makes that measurable.
 */
export const provenanceLogoOutcomeEnum = pgEnum('provenance_logo_outcome', [
  'used',
  'missing-no-logo',
  'missing-fetch-failed',
  'not-applicable',
]);

/** A candidate that was considered and passed over, and why. */
export interface RejectedCandidate {
  assetId: string;
  /** Machine-readable reason, e.g. 'recently-used', 'no-thumbnail'. */
  reason: string;
  /** Free-text detail for a human reading the row later. */
  detail?: string;
}

export const contentGenerationProvenance = pgTable(
  'content_generation_provenance',
  {
    id: text('id').primaryKey(),

    subjectType: provenanceSubjectEnum('subject_type').notNull(),
    /** graphic.id / video.id. Not an FK — provenance outlives its subject. */
    subjectId: text('subject_id').notNull(),

    /** Batch context, when this came from a monthly batch. */
    batchId: text('batch_id'),
    batchItemId: text('batch_item_id'),

    /** The service the content is ABOUT — the claim the media has to support. */
    serviceId: text('service_id').references(() => organizationService.id, {
      onDelete: 'set null',
    }),

    // ── The decision, as queryable columns ────────────────────────────────
    /** Null when the source is `stock` / `none` / `ai-generated`. */
    chosenAssetId: text('chosen_asset_id').references(() => asset.id, {
      onDelete: 'set null',
    }),
    mediaSource: provenanceMediaSourceEnum('media_source').notNull(),
    logoOutcome: provenanceLogoOutcomeEnum('logo_outcome')
      .notNull()
      .default('not-applicable'),

    /** Candidates considered, and how many were passed over. */
    candidatesConsidered: text('candidates_considered').array(),
    rejectedCandidates: jsonb('rejected_candidates').$type<
      RejectedCandidate[]
    >(),

    /** Which design/template produced this, when applicable. */
    templateSlug: text('template_slug'),
    /** Generation model, so a quality regression can be traced to a swap. */
    model: text('model'),

    /**
     * Anything not worth its own column — prompt hashes, copy decks, scores.
     * Keep genuinely queryable signals as columns; this is for context.
     */
    detail: jsonb('detail').$type<Record<string, unknown>>(),

    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    // Rotation: "what has this service used recently?"
    index('cgp_org_service_created_idx').on(
      t.organizationId,
      t.serviceId,
      t.createdAt
    ),
    // Diagnosis: "why does this graphic look like that?"
    index('cgp_subject_idx').on(t.subjectType, t.subjectId),
    // Reporting: "how often do we fall back to stock / miss the logo?"
    index('cgp_org_created_idx').on(t.organizationId, t.createdAt),
  ]
);

export const contentGenerationProvenanceRlsPolicy = orgRlsPolicy(
  contentGenerationProvenance
);

export const contentGenerationProvenanceRelations = relations(
  contentGenerationProvenance,
  ({ one }) => ({
    organization: one(organization, {
      fields: [contentGenerationProvenance.organizationId],
      references: [organization.id],
    }),
    service: one(organizationService, {
      fields: [contentGenerationProvenance.serviceId],
      references: [organizationService.id],
    }),
    chosenAsset: one(asset, {
      fields: [contentGenerationProvenance.chosenAssetId],
      references: [asset.id],
    }),
  })
);

export type ContentGenerationProvenance =
  typeof contentGenerationProvenance.$inferSelect;
export type NewContentGenerationProvenance =
  typeof contentGenerationProvenance.$inferInsert;
