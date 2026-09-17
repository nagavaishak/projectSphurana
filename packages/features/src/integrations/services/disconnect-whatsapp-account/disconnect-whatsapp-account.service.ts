import { whatsappAccount, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
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
  type DisconnectWhatsAppAccountInput,
  disconnectWhatsAppAccountSchema,
} from './disconnect-whatsapp-account.schema.js';

/**
 * Internal implementation of disconnect WhatsApp account
 */
const disconnectWhatsAppAccountImpl = async (
  db: DbConnection,
  input: DisconnectWhatsAppAccountInput
): Promise<Result<{ success: true }>> => {
  const parsed = disconnectWhatsAppAccountSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, accountId } = parsed.data;

  try {
    // Verify account belongs to organization before deleting
    const existing = await db.query.whatsappAccount.findFirst({
      where: (t, { and, eq }) =>
        and(eq(t.id, accountId), eq(t.organizationId, organizationId)),
    });

    if (!existing) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'WhatsApp account not found')
      );
    }

    // Delete the account
    await db
      .delete(whatsappAccount)
      .where(
        and(
          eq(whatsappAccount.id, accountId),
          eq(whatsappAccount.organizationId, organizationId)
        )
      );

    return ok({ success: true as const });
  } catch (error) {
    logError('integrations.disconnectWhatsAppAccount', error, {
      feature: 'integrations',
      extra: { organizationId, accountId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to disconnect WhatsApp account'
      )
    );
  }
};

/**
 * Disconnect a WhatsApp account from an organization
 */
export const disconnectWhatsAppAccount = (
  db: DbConnection,
  input: DisconnectWhatsAppAccountInput
) =>
  trackedResult(
    'integrations.disconnectWhatsAppAccount',
    () =>
      withOrgScope((tx) => disconnectWhatsAppAccountImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type DisconnectWhatsAppAccountResult = Awaited<
  ReturnType<typeof disconnectWhatsAppAccount>
>;
