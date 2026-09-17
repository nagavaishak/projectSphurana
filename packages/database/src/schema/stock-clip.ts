import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

import type { AssetContentType, AssetType } from '@borradh-workspace/labels';
import {
  agentDeclarableSources,
  stockClipSourceValues,
} from '@borradh-workspace/labels';
// Shared with `asset` so both storage classes expose an identical descriptor.
// Imported from treatment-taxonomy (a leaf) rather than asset.ts, which would
// re-introduce the very import cycle this table is structured to avoid.
import { clipAgentSourceEnum, clipFramingEnum } from './treatment-taxonomy.js';

/**
 * Where a stock clip came from. Declared here rather than in
 * treatment-taxonomy.ts because it is stock-only — `asset` rows are org
 * uploads and have no licensor. stock_clip imports nothing else from schema/,
 * so declaring a pgEnum here keeps it a dependency leaf.
 */
export const stockClipSourceEnum = pgEnum(
  'stock_clip_source',
  stockClipSourceValues
);

/**
 * stock_clip — global, curated catalog of high-quality stock footage used to
 * auto-fill b-roll when an organization hasn't uploaded its own content. Lets us
 * drop the footage-upload requirement that was costing 2–3 weeks of onboarding.
 * See docs/implementations/stock-footage-library.md.
 *
 * GLOBAL / NOT org-scoped — intentionally NO organization_id and NO RLS policy.
 * This is shared reference data (like a template catalog), readable by every org.
 * Org isolation happens one level down: the selector mints an org-OWNED `asset`
 * row (source='stock', stock_clip_id set) copy-on-attach, and THAT asset row
 * carries the org RLS policy. This is what keeps stock RLS-safe when RLS_ENABLED
 * flips on (the queueVideoExport gate reads b-roll under withOrgScope).
 *
 * contentType reuses the asset-analysis taxonomy
 * (@borradh-workspace/labels AssetContentType) so a minted asset is
 * indistinguishable from an analyzed upload and the render compiler's tag-based
 * b-roll selection works unchanged. Stored as text (not the shared pgEnum) to
 * keep this table a dependency leaf — importing assetContentTypeEnum from
 * organization-service.ts would create an
 * asset → stock_clip → organization_service → asset import cycle.
 */
export const stockClip = pgTable(
  'stock_clip',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),

    // DEPRECATED — coarse niche grouping ('aesthetics'), keyed off the org's
    // business_type via STOCK_VERTICAL_BY_BUSINESS_TYPE. Retired because
    // business_type is demonstrably unreliable: a 2026-07-29 prod audit found
    // five orgs typed `hairdresser` selling laser hair removal, tear-trough
    // filler and IV drips, while `aesthetic_clinic` orgs sell acrylic refills.
    // The vertical map left 590 services with no bank at all and would hand
    // aesthetics procedure clips to nail salons.
    //
    // Replaced by (techniqueSlug, agentSlug, regions) below. Kept nullable
    // through the transition; drop once the bank is re-seeded.
    vertical: text('vertical'),

    // ── FOOTAGE DESCRIPTOR ───────────────────────────────────────────────
    // Identical to the descriptor on `asset` so one matcher ranks own footage
    // and stock together via the matchable_clip view.
    //
    // Stock is 100% HAND-DECLARED at curation. Unlike uploads there is no
    // inference step and no vision in this path at all: a few hundred clips,
    // labelled once by whoever curated them, amortised across every org. The
    // curator knows what they filmed; a model would only guess.
    agentSlug: text('agent_slug'),
    techniqueSlug: text('technique_slug'),
    regions: text('regions').array().notNull().default([]),

    // 'curated' only where the agent could actually be DECLARED — i.e. where
    // whoever put the clip in the bank was present when it was filmed
    // (source 'shot' or 'pooled'). Licensed footage carries 'unconfirmed'
    // regardless of how confident the reviewer felt, because machine identity
    // is not observable in the frame. See stockClipSourceLabels.
    agentSource: clipAgentSourceEnum('agent_source')
      .notNull()
      .default('curated'),

    // ── HOW IT ENTERED THE BANK ──────────────────────────────────────────
    // Functional only: this decides whether `agent_slug` may be set. It
    // deliberately does NOT record which external library a clip came from —
    // 'provider' is a single opaque value covering all of them.
    //
    // Defaults to 'provider', the LEAST privileged value, so the column fails
    // closed. 'shot' and 'pooled' permit a non-null agent_slug, and an unset
    // column is not a declaration — defaulting to 'shot' silently granted 52
    // legacy rows of unknown origin the right to assert machine identity.
    // Own-shoot and pooled footage must say so explicitly.
    source: stockClipSourceEnum('source').notNull().default('provider'),

    // Opaque external identifier, used solely to stop the same asset being
    // ingested twice (see uq_stock_clip_external_asset). Carries no
    // information about which library issued it.
    externalAssetId: text('external_asset_id'),

    // When the clip was acquired. A date, nothing more.
    acquiredAt: timestamp('acquired_at'),

    // Whether a recognisable face is visible. Descriptive only — NOT a gate.
    //
    // Releases covering medical/aesthetic depiction are confirmed for the
    // current bank, so identifiability does not restrict procedure use. Kept
    // because it is cheap to observe, useful for composition (the shot list
    // specifies close-ups where instrument and skin fill the frame), and
    // because a future source with narrower terms would need it already
    // populated rather than backfilled across the whole bank.
    //
    // NULL = not yet assessed. Deliberately no default: a conservative default
    // would imply a gate that does not exist.
    hasIdentifiableFace: boolean('has_identifiable_face'),

    // ── SELECTED WINDOW ──────────────────────────────────────────────────
    // The 6–12s stretch worth using. Only 37% of the licensed bank arrived
    // inside that window, so for most clips this is a chosen span rather than
    // the whole file.
    trimInMs: integer('trim_in_ms'),
    trimOutMs: integer('trim_out_ms'),

    // Observable from the frame, so safe to infer. Feeds the `expected_shot`
    // sentence both sides of the cosine comparison are written in.
    framing: clipFramingEnum('framing'),

    // What is visible in the frame, in the same register service
    // `expected_shot` text is written in, so the two sides of the cosine
    // comparison are described alike. Distinct from `description` below,
    // which is the curator's free-text note.
    visualDescription: text('visual_description'),

    // Visual role, reusing the asset content-type taxonomy. Stock is
    // overwhelmingly 'procedure' (service-specific) or 'environment' (the shared
    // generic/ambient pool). before/after/result stay upload-gated (real results
    // only) and are never seeded as stock.
    contentType: text('content_type').$type<AssetContentType>().notNull(),

    // True = reusable across every service in the vertical (reception, gloved
    // hands, product shelves, ambient). The selector tops service-specific picks
    // up from this pool, and falls back to it entirely when nothing clears the
    // match threshold.
    isGeneric: boolean('is_generic').notNull().default(false),

    // Curated one-liner — the signal the matcher reads. Quality here IS match
    // quality; treat it as part of curation, not an afterthought.
    description: text('description').notNull(),

    mediaType: text('media_type').$type<AssetType>().notNull().default('video'),

    // Pre-uploaded, pre-transcoded S3 object the minted asset points at.
    // blobUrl = original; transcodedBlobUrl = normalized H.264 (what renders).
    blobUrl: text('blob_url').notNull(),
    transcodedBlobUrl: text('transcoded_blob_url'),
    durationSec: real('duration_sec'),
    width: integer('width'),
    height: integer('height'),

    // pgvector embedding of visualDescription. Ranks candidates WITHIN the
    // gate — it decides which of the ALLOWED clips fits best, never whether a
    // clip is allowed. Similarity cannot make that second call: endospheres
    // and EMS footage are near-neighbours precisely because they look the
    // same, so there is no threshold that separates them.
    embedding: vector('embedding', { dimensions: 1536 }),

    active: boolean('active').notNull().default(true),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index('idx_stock_clip_vertical').on(table.vertical),
    index('idx_stock_clip_content_type').on(table.contentType),
    // The gate's WHERE clause: technique + agent narrow the candidate set
    // before the embedding ranks it.
    index('idx_stock_clip_technique').on(table.techniqueSlug),
    index('idx_stock_clip_agent').on(table.agentSlug),
    index('idx_stock_clip_source').on(table.source),

    // One bank row per external asset. Stops the same clip being acquired and
    // ingested twice — paying twice, and putting near-duplicates in front of
    // the ranker, which would then pick between them on noise.
    uniqueIndex('uq_stock_clip_external_asset')
      .on(table.externalAssetId)
      .where(sql`${table.externalAssetId} is not null`),

    // Machine identity is not observable in a frame, so only footage whose
    // origin could actually witness it may assert one. Enforced here rather
    // than in the review UI: a constraint holds for backfills, scripts and
    // future call sites, and this is the exact failure the whole matching
    // design exists to prevent (EMS footage offered to an endospheres clinic).
    //
    // sql.raw, not interpolation — interpolated values become bind parameters,
    // which are not valid inside a CHECK constraint. Drizzle emits them as
    // `in ($1, $2)` with no warning.
    check(
      'stock_clip_agent_requires_declarable_source',
      sql`${table.agentSlug} is null or ${table.source} in (${sql.raw(
        agentDeclarableSources.map((s) => `'${s}'`).join(', ')
      )})`
    ),
  ]
);

export type StockClip = typeof stockClip.$inferSelect;
export type NewStockClip = typeof stockClip.$inferInsert;
