import {
  assistantWhatsappLink,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, ne } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetWhatsappLinkStatusInput,
  type WhatsappLinkStatus,
  getWhatsappLinkStatusSchema,
} from './get-whatsapp-link-status.schema.js';

/**
 * Current pairing state for an owner, for the settings card to render +
 * poll. Returns the most recent non-revoked link (active wins over pending
 * implicitly by recency since verify replaces pending in place).
 */
const getWhatsappLinkStatusImpl = async (
  db: DbConnection,
  input: GetWhatsappLinkStatusInput
): Promise<Result<WhatsappLinkStatus>> => {
  const parsed = getWhatsappLinkStatusSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, organizationId } = parsed.data;

  try {
    const link = await withOrgScope(
      (tx) =>
        tx.query.assistantWhatsappLink.findFirst({
          where: and(
            eq(assistantWhatsappLink.userId, userId),
            eq(assistantWhatsappLink.organizationId, organizationId),
            ne(assistantWhatsappLink.status, 'revoked')
          ),
          orderBy: [desc(assistantWhatsappLink.createdAt)],
          columns: {
            id: true,
            status: true,
            phoneE164: true,
            verifiedAt: true,
            createdAt: true,
          },
        }),
      { db }
    );

    return ok({ link: link ?? null });
  } catch (error) {
    logError('assistant.getWhatsappLinkStatus', error, {
      feature: 'assistant',
      extra: { userId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to load WhatsApp link status'
      )
    );
  }
};

export const getWhatsappLinkStatus = (
  db: DbConnection,
  input: GetWhatsappLinkStatusInput
) =>
  trackedResult(
    'assistant.getWhatsappLinkStatus',
    () => getWhatsappLinkStatusImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );
