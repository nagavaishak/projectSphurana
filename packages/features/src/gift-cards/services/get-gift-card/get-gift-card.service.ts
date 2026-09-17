import {
  type GiftCard,
  type GiftCardTransaction,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetGiftCardInput,
  getGiftCardSchema,
} from './get-gift-card.schema.js';

export interface GiftCardWithTransactions extends GiftCard {
  transactions: GiftCardTransaction[];
}

const getGiftCardImpl = async (
  db: DbConnection,
  input: GetGiftCardInput
): Promise<Result<GiftCardWithTransactions>> => {
  const parsed = getGiftCardSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, giftCardId, code } = parsed.data;

  const result = await withOrgScope(
    (tx) =>
      tx.query.giftCard.findFirst({
        where: (t, { and, eq }) =>
          and(
            eq(t.organizationId, organizationId),
            giftCardId ? eq(t.id, giftCardId) : eq(t.code, code as string)
          ),
        with: {
          transactions: {
            orderBy: (t, { desc }) => [desc(t.createdAt)],
          },
        },
      }),
    { db }
  );

  if (!result) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Gift card not found'));
  }

  return ok(result as GiftCardWithTransactions);
};

export const getGiftCard = (db: DbConnection, input: GetGiftCardInput) =>
  trackedResult('giftCards.getGiftCard', () => getGiftCardImpl(db, input), {
    properties: {
      organizationId: input.organizationId,
      giftCardId: input.giftCardId,
    },
    internalErrorsOnly: true,
  });

export type GetGiftCardResult = Awaited<ReturnType<typeof getGiftCard>>;
