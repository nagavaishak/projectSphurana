import {
  type GiftCard,
  giftCard,
  giftCardTransaction,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type AdjustGiftCardInput,
  adjustGiftCardSchema,
} from './adjust-gift-card.schema.js';

const adjustGiftCardImpl = async (
  db: DbConnection,
  input: AdjustGiftCardInput
): Promise<Result<GiftCard>> => {
  const parsed = adjustGiftCardSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, giftCardId, amountCents, createdById } = parsed.data;

  try {
    // A real `tx.transaction` makes the ledger insert + balance update atomic
    // REGARDLESS of the RLS flag (withOrgScope is a pass-through with no
    // transaction when RLS is off). Under RLS on it nests as a savepoint.
    const result = await withOrgScope(
      (outerTx) =>
        outerTx.transaction(async (tx) => {
          const existing = await tx.query.giftCard.findFirst({
            where: (t, { and: andOp, eq: eqOp }) =>
              andOp(
                eqOp(t.id, giftCardId),
                eqOp(t.organizationId, organizationId)
              ),
          });

          if (!existing) {
            return {
              error: new FeatureError(
                ErrorCodes.NOT_FOUND,
                'Gift card not found'
              ),
            };
          }

          // Fast pre-check for a friendly error message.
          if (existing.balanceCents + amountCents < 0) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Adjustment would make the gift card balance negative'
              ),
            };
          }

          // Atomic, race-safe adjustment: the conditional WHERE recomputes the
          // guard against the live balance, so a concurrent redeem can't slip a
          // negative balance past us. 0 rows affected ⇒ would go negative.
          const [updated] = await tx
            .update(giftCard)
            .set({
              balanceCents: sql`${giftCard.balanceCents} + ${amountCents}`,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(giftCard.id, giftCardId),
                eq(giftCard.organizationId, organizationId),
                sql`${giftCard.balanceCents} + ${amountCents} >= 0`
              )
            )
            .returning();

          if (!updated) {
            return {
              error: new FeatureError(
                ErrorCodes.INVALID_STATE,
                'Adjustment would make the gift card balance negative'
              ),
            };
          }

          await tx.insert(giftCardTransaction).values({
            giftCardId,
            type: 'adjust',
            amountCents,
            createdById: createdById ?? null,
          });

          return { updated };
        }),
      { db }
    );

    if (result.error) {
      return err(result.error);
    }

    return ok(result.updated as GiftCard);
  } catch (error) {
    logError('giftCards.adjustGiftCard', error, {
      feature: 'gift-cards',
      extra: { organizationId, giftCardId, amountCents },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to adjust gift card')
    );
  }
};

export const adjustGiftCard = (db: DbConnection, input: AdjustGiftCardInput) =>
  trackedResult(
    'giftCards.adjustGiftCard',
    () => adjustGiftCardImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        giftCardId: input.giftCardId,
        amountCents: input.amountCents,
      },
    }
  );

export type AdjustGiftCardResult = Awaited<ReturnType<typeof adjustGiftCard>>;
