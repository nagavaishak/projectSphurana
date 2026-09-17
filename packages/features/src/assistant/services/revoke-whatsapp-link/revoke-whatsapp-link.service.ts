import {
  assistantWhatsappLink,
  withOrgScope,
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
import {
  type RevokeWhatsappLinkInput,
  revokeWhatsappLinkSchema,
} from './revoke-whatsapp-link.schema.js';

/**
 * Revoke a pairing link. Nulls `phoneE164` so the number can be re-paired later
 * (the UNIQUE constraint would otherwise block a fresh `verify`).
 */
const revokeWhatsappLinkImpl = async (
  db: DbConnection,
  input: RevokeWhatsappLinkInput
): Promise<Result<{ id: string }>> => {
  const parsed = revokeWhatsappLinkSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id, userId } = parsed.data;

  try {
    const rows = await withOrgScope(
      (tx) =>
        tx
          .update(assistantWhatsappLink)
          .set({
            status: 'revoked',
            phoneE164: null,
            verificationCode: null,
            codeExpiresAt: null,
          })
          .where(
            and(
              eq(assistantWhatsappLink.id, id),
              eq(assistantWhatsappLink.userId, userId)
            )
          )
          .returning({ id: assistantWhatsappLink.id }),
      { db }
    );

    if (!rows || rows.length === 0) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'WhatsApp link not found')
      );
    }

    return ok({ id: rows[0].id });
  } catch (error) {
    logError('assistant.revokeWhatsappLink', error, {
      feature: 'assistant',
      extra: { id, userId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to revoke WhatsApp link'
      )
    );
  }
};

export const revokeWhatsappLink = (
  db: DbConnection,
  input: RevokeWhatsappLinkInput
) =>
  trackedResult(
    'assistant.revokeWhatsappLink',
    () => revokeWhatsappLinkImpl(db, input),
    { properties: { id: input.id }, internalErrorsOnly: true }
  );
