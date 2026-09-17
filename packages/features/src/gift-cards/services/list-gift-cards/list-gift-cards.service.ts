import {
  type GiftCard,
  giftCard,
  sale,
  saleItem,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type SQL,
  and,
  count,
  desc,
  eq,
  exists,
  ilike,
  isNull,
  or,
} from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListGiftCardsInput,
  listGiftCardsSchema,
} from './list-gift-cards.schema.js';

export interface ListGiftCardsResult {
  items: GiftCard[];
  total: number;
  limit: number;
  offset: number;
}

const listGiftCardsImpl = async (
  db: DbConnection,
  input: ListGiftCardsInput
): Promise<Result<ListGiftCardsResult>> => {
  const parsed = listGiftCardsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, locationId, search, limit, offset } =
    parsed.data;

  const conditions: SQL[] = [eq(giftCard.organizationId, organizationId)];
  if (leadId) {
    conditions.push(eq(giftCard.leadId, leadId));
  }
  if (search) {
    conditions.push(ilike(giftCard.code, `%${search}%`));
  }
  if (locationId) {
    // Issued here, OR not traceable to a sale at all — see the schema note.
    conditions.push(
      or(
        isNull(giftCard.saleItemId),
        exists(
          db
            .select({ one: saleItem.id })
            .from(saleItem)
            .innerJoin(sale, eq(saleItem.saleId, sale.id))
            .where(
              and(
                eq(saleItem.id, giftCard.saleItemId),
                // Tolerant of a sale with no branch yet, for the same reason
                // as `atLocationOrUnscoped`: every sale in production is
                // currently unfiled, and a card sold at the till carries a
                // saleItemId, so a strict match hides every card a customer
                // actually bought — i.e. the outstanding liability.
                or(eq(sale.locationId, locationId), isNull(sale.locationId))
              )
            )
        )
      ) as SQL
    );
  }

  const whereClause = and(...conditions);

  const [items, countResult] = await withOrgScope(
    async (tx) => {
      // CORE select, not `tx.query.giftCard.findMany`.
      //
      // The relational query builder ALIASES its root table, so the correlated
      // `exists(...)` above — which references `giftCard.saleItemId`, and so
      // compiles to "gift_card"."sale_item_id" — pointed at a name that was not
      // in the FROM clause: `invalid reference to FROM-clause entry for table
      // "gift_card"`, a 500 on every list. The count query below never broke
      // because it always used the core API, where the name matches.
      //
      // This is not hypothetical or test-only: `locationId` comes from
      // @ActiveLocation(), so the branch is taken for any org that has a
      // location — which, since locations became the unit of work, is all of
      // them. There are no relations to load here, so the core select returns
      // exactly the same rows.
      const rows = await tx
        .select()
        .from(giftCard)
        .where(whereClause)
        .orderBy(desc(giftCard.createdAt))
        .limit(limit)
        .offset(offset);
      const [ct] = await tx
        .select({ total: count() })
        .from(giftCard)
        .where(whereClause);
      return [rows, ct] as const;
    },
    { db }
  );

  return ok({ items, total: countResult.total, limit, offset });
};

export const listGiftCards = (db: DbConnection, input: ListGiftCardsInput) =>
  trackedResult('giftCards.listGiftCards', () => listGiftCardsImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

export type ListGiftCardsServiceResult = Awaited<
  ReturnType<typeof listGiftCards>
>;
