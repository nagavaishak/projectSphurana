import {
  assistantWhatsappLink,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';

export interface ResolvedOwner {
  userId: string;
  organizationId: string;
}

/**
 * Hot path for the inbound WhatsApp webhook: map a sender's E.164 to the owner
 * + org of the ACTIVE pairing link, or `null` if the number isn't paired.
 *
 * Cross-org (the webhook has no org context) so it runs on the SYSTEM scope.
 * Internal-errors-only logging — an unpaired number is an expected `null`, not
 * an error.
 */
const resolveOwnerByPhoneImpl = async (
  db: DbConnection,
  phoneE164: string
): Promise<Result<ResolvedOwner | null>> => {
  if (!phoneE164) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'phoneE164 is required')
    );
  }

  try {
    const link = await withSystemScope(
      (conn) =>
        conn.query.assistantWhatsappLink.findFirst({
          where: and(
            eq(assistantWhatsappLink.phoneE164, phoneE164),
            eq(assistantWhatsappLink.status, 'active')
          ),
          columns: { userId: true, organizationId: true },
        }),
      { db }
    );

    if (!link) {
      return ok(null);
    }

    return ok({
      userId: link.userId,
      organizationId: link.organizationId,
    });
  } catch (error) {
    logError('assistant.resolveOwnerByPhone', error, {
      feature: 'assistant',
      extra: { phoneE164 },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to resolve owner by phone'
      )
    );
  }
};

export const resolveOwnerByPhone = (db: DbConnection, phoneE164: string) =>
  trackedResult(
    'assistant.resolveOwnerByPhone',
    () => resolveOwnerByPhoneImpl(db, phoneE164),
    { internalErrorsOnly: true }
  );
