import {
  assetContentTypeValues,
  assetTypeValues,
  clipFramingValues,
  stockClipSourceValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';

/**
 * Input for upserting a curated stock clip catalog row. `blobUrl` is the
 * content-addressed object URL returned by `publishStockClip`, and is the
 * natural key the upsert dedupes on (re-seeding identical bytes is a no-op).
 *
 * The descriptor fields below are what the matcher actually gates and ranks on.
 * Without them a seeded clip is unreachable: the gate matches on a declared
 * `techniqueSlug`, so a row carrying only `vertical` and a free-text
 * `description` can never be admitted, and every service falls through to
 * ambient. `vertical` itself is retained only for the pre-0098 rows still in
 * the catalog — a 2026 prod audit found it unreliable (five orgs typed
 * `hairdresser` sell laser hair removal and tear-trough filler), and nothing
 * reads it any more.
 */
export const upsertStockClipSchema = z.object({
  // DEPRECATED. Optional so new callers can omit it entirely.
  vertical: z.string().min(1).optional(),
  contentType: z.enum(assetContentTypeValues),
  isGeneric: z.boolean().default(false),
  description: z.string().min(1, 'Description required'),
  mediaType: z.enum(assetTypeValues).default('video'),
  blobUrl: z.string().min(1, 'blobUrl required'),
  // Pre-normalized H.264 copy. Stock source is curated render-ready, so the
  // seed sets this to the same object URL; the worker renders transcodedBlobUrl
  // when present (else blobUrl).
  transcodedBlobUrl: z.string().optional(),
  durationSec: z.number().positive().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  active: z.boolean().default(true),

  // ── Footage descriptor — what the matcher reads ──────────────────────────
  /**
   * The visually-distinguishable class. THE gate key: a clip without one can
   * only ever serve the ambient pool.
   */
  techniqueSlug: z.string().min(1).nullish(),
  /**
   * Body regions the clip can legitimately illustrate. Empty is meaningful —
   * it means region-neutral, and the gate skips the overlap test rather than
   * running it against an empty array (`regions && '{}'` is always false).
   */
  regions: z.array(z.string()).default([]),
  /**
   * What is visible in the frame, written in the same register as a service's
   * `expected_shot`. THIS is what gets embedded — comparing a service name to a
   * clip description compares two different kinds of text.
   */
  visualDescription: z.string().min(1).nullish(),
  framing: z.enum(clipFramingValues).nullish(),
  /** The usable 6–12s window; most source clips arrive longer. */
  trimInMs: z.number().int().min(0).nullish(),
  trimOutMs: z.number().int().min(0).nullish(),
  hasIdentifiableFace: z.boolean().nullish(),

  // ── Provenance ──────────────────────────────────────────────────────────
  /**
   * How the clip entered the bank. Decides whether `agent_slug` may ever be
   * set — a DB CHECK constraint rejects a non-null agent on `provider` rows,
   * because machine identity is not observable in a frame and only footage
   * whose origin could witness it may assert one.
   *
   * Deliberately does NOT record which external library a clip came from.
   */
  source: z.enum(stockClipSourceValues).default('provider'),
  /** Opaque external id, used only to stop the same asset being seeded twice. */
  externalAssetId: z.string().min(1).nullish(),
  acquiredAt: z.date().nullish(),
});

export type UpsertStockClipInput = z.infer<typeof upsertStockClipSchema>;
