import { whatsappAccount, withOrgScope } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import type { WhatsAppTemplate } from '@borradh-workspace/integrations/whatsapp';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { handleWhatsAppError } from '../../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListWhatsappTemplatesInput,
  listWhatsappTemplatesSchema,
} from './list-whatsapp-templates.schema.js';

const listWhatsappTemplatesImpl = async (
  db: DbConnection,
  input: ListWhatsappTemplatesInput
): Promise<Result<WhatsAppTemplate[]>> => {
  const parsed = listWhatsappTemplatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const account = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.id, parsed.data.accountId),
      eq(whatsappAccount.organizationId, parsed.data.organizationId)
    ),
  });

  if (!account) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'WhatsApp account not found')
    );
  }

  try {
    const credentials = decryptCredentials<{ accessToken: string }>(
      account.encryptedCredentials
    );

    const client = new WhatsAppCloudService(
      credentials.accessToken,
      account.phoneNumberId
    );

    const templates = await client.listTemplates(account.wabaId);
    return ok(templates);
  } catch (error) {
    return handleWhatsAppError(error, {
      operationName: 'integrations.listWhatsappTemplates',
      extra: { accountId: parsed.data.accountId },
      defaultUserTitle: 'Failed to List WhatsApp Templates',
      db,
      organizationId: parsed.data.organizationId,
    });
  }
};

export const listWhatsappTemplates = (
  db: DbConnection,
  input: ListWhatsappTemplatesInput
) =>
  trackedResult(
    'integrations.listWhatsappTemplates',
    () => withOrgScope((tx) => listWhatsappTemplatesImpl(tx, input), { db }),
    { properties: { accountId: input.accountId } }
  );

export type ListWhatsappTemplatesResult = Awaited<
  ReturnType<typeof listWhatsappTemplates>
>;
