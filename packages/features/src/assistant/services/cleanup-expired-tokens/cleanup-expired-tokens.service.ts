import { claireConfirmationToken } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { isNotNull, lt, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface CleanupExpiredTokensOutput {
  deleted: number;
}

// NOTE (RLS W-SYS flag): cleanupExpiredTokens is a cross-org cron job — it
// deletes expired/consumed tokens across ALL organizations. Must be called with
// withSystemScope (BYPASSRLS) by the scheduler. W-SYS to wire at the call site.
const cleanupExpiredTokensImpl = async (
  db: DbConnection
): Promise<Result<CleanupExpiredTokensOutput>> => {
  try {
    // Delete rows that are either consumed or past their expiry. The cleanup
    // cron is the only caller — keeping the table small is the goal; nothing
    // depends on the deleted rows.
    const result = await db
      .delete(claireConfirmationToken)
      .where(
        or(
          isNotNull(claireConfirmationToken.consumedAt),
          lt(claireConfirmationToken.expiresAt, new Date())
        )
      )
      .returning({ id: claireConfirmationToken.id });

    return ok({ deleted: result.length });
  } catch (error) {
    logError('assistant.cleanupExpiredTokens', error, {
      feature: 'assistant',
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to clean up confirmation tokens'
      )
    );
  }
};

export const cleanupExpiredTokens = (db: DbConnection) =>
  trackedResult(
    'assistant.cleanupExpiredTokens',
    () => cleanupExpiredTokensImpl(db),
    {}
  );

export type CleanupExpiredTokensResult = Awaited<
  ReturnType<typeof cleanupExpiredTokens>
>;
