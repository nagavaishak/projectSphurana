import { whatsappAccount, withOrgScope } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
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
  type DeleteWhatsappTemplateInput,
  deleteWhatsappTemplateSchema,
} from './delete-whatsapp-template.schema.js';

const deleteWhatsappTemplateImpl = async (
  db: DbConnection,
  input: DeleteWhatsappTemplateInput
): Promise<Result<{ success: boolean }>> => {
  const parsed = deleteWhatsappTemplateSchema.safeParse(input);
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

    await client.deleteTemplate(account.wabaId, parsed.data.templateName);
    return ok({ success: true });
  } catch (error) {
    return handleWhatsAppError(error, {
      operationName: 'integrations.deleteWhatsappTemplate',
      extra: {
        accountId: parsed.data.accountId,
        templateName: parsed.data.templateName,
      },
      defaultUserTitle: 'Failed to Delete WhatsApp Template',
      db,
      organizationId: parsed.data.organizationId,
    });
  }
};

export const deleteWhatsappTemplate = (
  db: DbConnection,
  input: DeleteWhatsappTemplateInput
) =>
  trackedResult(
    'integrations.deleteWhatsappTemplate',
    () => withOrgScope((tx) => deleteWhatsappTemplateImpl(tx, input), { db }),
    {
      properties: {
        accountId: input.accountId,
        templateName: input.templateName,
      },
    }
  );

export type DeleteWhatsappTemplateResult = Awaited<
  ReturnType<typeof deleteWhatsappTemplate>
>;
