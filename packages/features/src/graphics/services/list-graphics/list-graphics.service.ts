import {
  contentAttempt,
  contentItem,
  graphic,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { GraphicWithTemplate } from '../get-graphic/get-graphic.service.js';
import {
  type ListGraphicsInput,
  listGraphicsSchema,
} from './list-graphics.schema.js';

/**
 * A graphic, plus the content item that owns it.
 *
 * `itemId` is here so that the ONE id an editor needs is the one a lister hands
 * out. Every edit addresses the item — `patchContent` takes nothing else — and
 * a list that returned only graphic ids left the caller holding the wrong one.
 * That is not hypothetical: passing an asset id where an item id belonged
 * returned a not-found, which is indistinguishable from "this post cannot be
 * edited", and got reported to an owner as the post being locked.
 *
 * Null for a graphic with no item — onboarding ad candidates are not content
 * items, and anything predating item tracking has not been adopted yet.
 */
export type GraphicWithItem = GraphicWithTemplate & { itemId: string | null };

export interface ListGraphicsResponse {
  items: GraphicWithItem[];
  limit: number;
  offset: number;
}

const listGraphicsImpl = async (
  db: DbConnection,
  input: ListGraphicsInput
): Promise<Result<ListGraphicsResponse>> => {
  const parsed = listGraphicsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, status, limit, offset } = parsed.data;

  const conditions = [eq(graphic.organizationId, organizationId)];
  if (status) {
    conditions.push(eq(graphic.status, status));
  }

  const items = await withOrgScope(
    (tx) =>
      tx.query.graphic.findMany({
        where: and(...conditions),
        limit,
        offset,
        orderBy: [desc(graphic.createdAt)],
      }),
    { db }
  );

  // One extra query rather than a join on the main list: the item lives two
  // tables away (attempt → item) and joining would reshape every row for a
  // field most callers ignore.
  const graphicIds = items.map((row) => row.id);
  // BEST-EFFORT. `itemId` is lineage — useful, never load-bearing for showing
  // the library. Left unguarded, a failure in this lookup took the whole
  // graphics list down with it, and the graphics list is what the ad wizard's
  // media step is made of. The same rule the rest of this vertical follows: an
  // item problem must not become a content problem.
  const owners = graphicIds.length
    ? await withOrgScope(
        (tx) =>
          tx
            .select({
              graphicId: contentAttempt.graphicId,
              itemId: contentItem.id,
            })
            .from(contentAttempt)
            .innerJoin(contentItem, eq(contentItem.id, contentAttempt.slotId))
            .where(
              and(
                eq(contentAttempt.organizationId, organizationId),
                inArray(contentAttempt.graphicId, graphicIds)
              )
            ),
        { db }
      ).catch(() => [])
    : [];
  const itemByGraphic = new Map(
    owners
      .filter((row): row is { graphicId: string; itemId: string } =>
        Boolean(row.graphicId)
      )
      .map((row) => [row.graphicId, row.itemId])
  );

  return ok({
    items: (items as GraphicWithTemplate[]).map((row) => ({
      ...row,
      itemId: itemByGraphic.get(row.id) ?? null,
    })),
    limit,
    offset,
  });
};

export const listGraphics = (db: DbConnection, input: ListGraphicsInput) =>
  trackedResult('graphics.listGraphics', () => listGraphicsImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

export type ListGraphicsResult = Awaited<ReturnType<typeof listGraphics>>;
