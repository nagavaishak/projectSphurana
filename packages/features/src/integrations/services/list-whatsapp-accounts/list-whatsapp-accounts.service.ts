import {
  user,
  whatsappAccount,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListWhatsAppAccountsInput,
  listWhatsAppAccountsSchema,
} from './list-whatsapp-accounts.schema.js';

export interface WhatsAppAccountInfo {
  id: string;
  phoneNumberId: string;
  phoneNumber: string;
  displayName: string | null;
  isChatbotActive: boolean;
  isActive: boolean;
  isVerified: boolean;
  connectedByName: string | null;
  tokenExpiresAt: Date | null;
  tokenStatus: 'valid' | 'needs_reconnect';
  createdAt: Date;
}

/**
 * Internal implementation of list WhatsApp accounts
 */
const listWhatsAppAccountsImpl = async (
  db: DbConnection,
  input: ListWhatsAppAccountsInput
): Promise<Result<WhatsAppAccountInfo[]>> => {
  const parsed = listWhatsAppAccountsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  try {
    const accounts = await db
      .select({
        id: whatsappAccount.id,
        phoneNumberId: whatsappAccount.phoneNumberId,
        phoneNumber: whatsappAccount.phoneNumber,
        displayName: whatsappAccount.displayName,
        isChatbotActive: whatsappAccount.isChatbotActive,
        isActive: whatsappAccount.isActive,
        isVerified: whatsappAccount.isVerified,
        connectedByName: user.name,
        tokenExpiresAt: whatsappAccount.tokenExpiresAt,
        tokenStatus: whatsappAccount.tokenStatus,
        createdAt: whatsappAccount.createdAt,
      })
      .from(whatsappAccount)
      .leftJoin(user, eq(whatsappAccount.connectedById, user.id))
      .where(eq(whatsappAccount.organizationId, organizationId))
      .orderBy(whatsappAccount.createdAt);

    return ok(accounts);
  } catch (error) {
    logError('integrations.listWhatsAppAccounts', error, {
      feature: 'integrations',
      extra: { organizationId },
    });

    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to list WhatsApp accounts'
      )
    );
  }
};

/**
 * List all WhatsApp accounts for an organization
 */
export const listWhatsAppAccounts = (
  db: DbConnection,
  input: ListWhatsAppAccountsInput
) =>
  trackedResult(
    'integrations.listWhatsAppAccounts',
    () => withOrgScope((tx) => listWhatsAppAccountsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListWhatsAppAccountsResult = Awaited<
  ReturnType<typeof listWhatsAppAccounts>
>;
