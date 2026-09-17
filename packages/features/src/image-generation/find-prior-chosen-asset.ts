import { contentGenerationProvenance } from '@borradh-workspace/database';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DbConnection } from '../shared/index.js';

/**
 * Which photo did the previous render of this graphic (or slide) actually use?
 *
 * Amending a graphic must not change its photography as a side effect, but
 * `resolveSlotImage` selects by least-recently-used rotation — so simply
 * re-resolving during an edit hands the model a DIFFERENT photo than the one in
 * the image being edited. With both references in play the model re-composes
 * around the newcomer, which is how "add the logo" came back with the same
 * words over an entirely different photograph.
 *
 * The decision was already being recorded; it just was not being read back.
 * This is the read.
 *
 * Best-effort by design: a missing row (a render predating provenance, a slide
 * with no photographic area) yields `undefined`, and the caller resolves
 * normally. Diagnostics must not be able to fail a render.
 */
export async function findPriorChosenAssetIds(
  db: DbConnection,
  args: { graphicId: string; slideIndex?: number }
): Promise<string[] | undefined> {
  try {
    const rows = await db
      .select({ chosenAssetId: contentGenerationProvenance.chosenAssetId })
      .from(contentGenerationProvenance)
      .where(
        and(
          eq(contentGenerationProvenance.subjectId, args.graphicId),
          args.slideIndex === undefined
            ? sql`true`
            : sql`${contentGenerationProvenance.detail}->>'slideIndex' = ${String(args.slideIndex)}`
        )
      )
      .orderBy(desc(contentGenerationProvenance.createdAt))
      .limit(1);

    const chosen = rows[0]?.chosenAssetId;
    return chosen ? [chosen] : undefined;
  } catch {
    return undefined;
  }
}
