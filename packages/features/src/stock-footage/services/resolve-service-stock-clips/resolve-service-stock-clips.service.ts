import {
  organizationService,
  serviceStockClip,
  stockClip,
  technique,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, arrayOverlaps, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ResolveServiceStockClipsInput,
  resolveServiceStockClipsSchema,
} from './resolve-service-stock-clips.schema.js';

export interface ResolvedServiceStockClips {
  /** Grade the picks were admitted at, for observability and the gap report. */
  grade: 'technique' | 'ambient' | 'none';
  vertical: string | null;
  skipped?: 'no_spec' | 'no_candidates';
  picks: Array<{ stockClipId: string; rank: number; score: number }>;
}

/**
 * Match stock clips to a service: DECLARED identity gates, embedding ranks.
 *
 * Replaces an LLM-pick over `stock_clip.vertical`. That approach failed on both
 * halves. `vertical` was derived from the org's business_type, which a 2026
 * prod audit found unreliable — five orgs typed `hairdresser` sell laser hair
 * removal and tear-trough filler — and it is NULL on every clip ingested since.
 * And asking a model to choose from candidate descriptions cannot separate
 * treatments that look alike: a laser clip sits 0.331 from a radiofrequency
 * clip in embedding space, nearer than some RF clips are to each other.
 *
 * So similarity never decides ELIGIBILITY, only ORDER within an already-legal
 * set. The gate is a plain equality on a declared technique.
 *
 * Region rule: an EMPTY `regions` on the service means region-NEUTRAL, not
 * region-none. A service sold at category level ("Dermal Fillers") has no
 * region until consultation and should match any region, so the overlap test is
 * skipped rather than run against an empty array — `regions && '{}'` is always
 * false in Postgres and would silently return nothing for the majority of
 * services.
 *
 * A service with no technique falls through to ambient. That is the honest
 * outcome for a name like "Barrier Repair" or "Pigmentation", which names a
 * concern rather than a treatment: showing such a clinic a specific machine is
 * the exact failure this design exists to prevent.
 *
 * "Body Contouring" is a different kind of unknown and is NOT in that bucket —
 * it does say an energy device worked over a body. Which device it means is
 * decided at classification time, from the rest of the organisation's
 * catalogue; only when that reveals nothing does the row keep the
 * `energy_contact` PARENT, whose clips are the ones where the machine is
 * deliberately unidentifiable.
 */
const resolveServiceStockClipsImpl = async (
  db: DbConnection,
  input: ResolveServiceStockClipsInput
): Promise<Result<ResolvedServiceStockClips>> => {
  const parsed = resolveServiceStockClipsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationServiceId, limit } = parsed.data;

  const svc = await db.query.organizationService.findFirst({
    where: eq(organizationService.id, organizationServiceId),
    columns: {
      id: true,
      techniqueSlug: true,
      regions: true,
      expectedShot: true,
      expectedShotEmbedding: true,
    },
  });
  if (!svc) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }

  // Without an embedding there is nothing to rank by, so ordering falls back to
  // least-recently-created. The gate still applies — an unranked legal clip is
  // far better than a ranked illegal one.
  const orderBy = svc.expectedShotEmbedding
    ? sql`${stockClip.embedding} <=> ${JSON.stringify(svc.expectedShotEmbedding)}::vector`
    : sql`${stockClip.createdAt} asc`;

  const scoreExpr = svc.expectedShotEmbedding
    ? sql<number>`1 - (${stockClip.embedding} <=> ${JSON.stringify(svc.expectedShotEmbedding)}::vector)`
    : sql<number>`0`;

  let grade: ResolvedServiceStockClips['grade'] = 'none';
  let rows: Array<{ id: string; score: number }> = [];

  if (svc.techniqueSlug) {
    // arrayOverlaps, not a hand-built `&& ${regions}::text[]`. Drizzle binds a
    // JS array as a single scalar parameter, so the cast receives `lips` rather
    // than `{lips}` and Postgres raises `malformed array literal`. It failed
    // loudly, but only for services that HAVE regions — about a fifth of them —
    // so the majority path looked healthy.
    const regionClause =
      svc.regions && svc.regions.length > 0
        ? arrayOverlaps(stockClip.regions, svc.regions)
        : undefined;

    rows = await db
      .select({ id: stockClip.id, score: scoreExpr })
      .from(stockClip)
      .innerJoin(technique, eq(technique.slug, stockClip.techniqueSlug))
      .where(
        and(
          eq(stockClip.active, true),
          eq(stockClip.isGeneric, false),
          eq(technique.isProcedural, true),
          // EXACT technique match. A declaration reaches its own tag and
          // nothing else — not children, not parents.
          //
          // This used to also admit `technique.parentSlug = svc.techniqueSlug`,
          // so a service declaring a PARENT reached every CHILD. That is the
          // defect: "Body Contouring" → `energy_contact` made an EMS clinic
          // eligible for endospheres, cryolipolysis and laser-lipo footage
          // alike. Measured on the real 287-clip bank, that clause admitted 26
          // clips where exact match admits 7.
          //
          // Resolving WHICH machine a vague name means is not this query's job.
          // It happens once, at classification time, where the model is shown
          // the rest of the organisation's catalogue: a clinic that also sells
          // "Endymed contouring" has told us it owns radiofrequency, so its
          // "Body Contouring" service is classified `radiofrequency` outright.
          // Doing it there rather than here keeps the answer auditable in the
          // row instead of implicit in a join, and keeps this gate a plain
          // equality.
          //
          // A parent therefore survives on a row only when the catalogue really
          // did reveal nothing — and parent-tagged clips are exactly right for
          // that case, being the ones where the machine isn't identifiable.
          eq(stockClip.techniqueSlug, svc.techniqueSlug),
          regionClause
        )
      )
      .orderBy(orderBy)
      .limit(limit);

    if (rows.length > 0) grade = 'technique';
  }

  // Ambient is a real answer, not a failure: it is what an unspecified service
  // legitimately wants, and it carries every render while specs are thin.
  if (rows.length === 0) {
    rows = await db
      .select({ id: stockClip.id, score: scoreExpr })
      .from(stockClip)
      .where(and(eq(stockClip.active, true), eq(stockClip.isGeneric, true)))
      .orderBy(orderBy)
      .limit(limit);
    if (rows.length > 0) grade = 'ambient';
  }

  if (rows.length === 0) {
    return ok({
      grade: 'none',
      vertical: null,
      skipped: svc.techniqueSlug ? 'no_candidates' : 'no_spec',
      picks: [],
    });
  }

  const picks = rows.map((r, rank) => ({
    stockClipId: r.id,
    rank,
    score: Math.max(0, Math.min(1, Number(r.score) || 0)),
  }));

  try {
    // Manual pins are human decisions and outrank anything computed here.
    const pinned = await db.query.serviceStockClip.findMany({
      where: and(
        eq(serviceStockClip.organizationServiceId, organizationServiceId),
        eq(serviceStockClip.isPinned, true)
      ),
      columns: { stockClipId: true },
    });
    const pinnedClipIds = new Set(pinned.map((r) => r.stockClipId));

    await db
      .delete(serviceStockClip)
      .where(
        and(
          eq(serviceStockClip.organizationServiceId, organizationServiceId),
          eq(serviceStockClip.isPinned, false)
        )
      );

    const toInsert = picks
      .filter((p) => !pinnedClipIds.has(p.stockClipId))
      .map((p) => ({
        organizationServiceId,
        stockClipId: p.stockClipId,
        rank: p.rank,
        score: p.score,
        isPinned: false,
      }));
    if (toInsert.length > 0) {
      await db.insert(serviceStockClip).values(toInsert);
    }
  } catch (error) {
    logError('stockFootage.resolveServiceStockClips', error, {
      feature: 'stock-footage',
      extra: { organizationServiceId, grade },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to persist stock clip matches'
      )
    );
  }

  return ok({ grade, vertical: null, picks });
};

export const resolveServiceStockClips = (
  db: DbConnection,
  input: ResolveServiceStockClipsInput
) =>
  trackedResult(
    'stockFootage.resolveServiceStockClips',
    () => resolveServiceStockClipsImpl(db, input),
    { properties: { organizationServiceId: input.organizationServiceId } }
  );

export type ResolveServiceStockClipsResult = Awaited<
  ReturnType<typeof resolveServiceStockClips>
>;
