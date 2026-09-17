import {
  type WhatsappTemplate,
  whatsappAccount,
  whatsappTemplate,
  withOrgScope,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type CreateWhatsappTemplateInput,
  createWhatsappTemplateSchema,
} from './create-whatsapp-template.schema.js';

/** Meta template statuses → our whatsapp_template status enum. */
const META_STATUS_MAP: Record<string, WhatsappTemplate['status']> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
  PENDING: 'pending',
};

const toLocalStatus = (metaStatus: string): WhatsappTemplate['status'] =>
  META_STATUS_MAP[metaStatus.toUpperCase()] ?? 'pending';

const createWhatsappTemplateImpl = async (
  db: DbConnection,
  input: CreateWhatsappTemplateInput
): Promise<Result<{ id: string; status: string }>> => {
  const parsed = createWhatsappTemplateSchema.safeParse(input);
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

    const result = await client.createTemplate(account.wabaId, {
      name: parsed.data.name,
      category: parsed.data.category,
      language: parsed.data.language,
      body: parsed.data.body,
      headerText: parsed.data.headerText,
      footerText: parsed.data.footerText,
      bodyExample: parsed.data.bodyExample,
    });

    // Seed the campaign-side template cache so the newly-registered template
    // shows up in the composer's picker immediately (as `pending`) rather than
    // only after a manual "refresh" re-syncs from Meta. Best-effort: the
    // template already exists on Meta, so a cache-write failure must not fail
    // the registration — it will be reconciled on the next sync.
    try {
      await db
        .insert(whatsappTemplate)
        .values({
          organizationId: parsed.data.organizationId,
          name: parsed.data.name,
          languageCode: parsed.data.language,
          category: parsed.data.category,
          status: toLocalStatus(result.status),
          body: parsed.data.body,
          metaTemplateId: result.id,
          syncedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            whatsappTemplate.organizationId,
            whatsappTemplate.name,
            whatsappTemplate.languageCode,
          ],
          set: {
            category: parsed.data.category,
            status: toLocalStatus(result.status),
            body: parsed.data.body,
            metaTemplateId: result.id,
            syncedAt: new Date(),
          },
        });
    } catch (cacheError) {
      logError('integrations.createWhatsappTemplate.cache', cacheError, {
        feature: 'integrations',
        extra: {
          organizationId: parsed.data.organizationId,
          templateName: parsed.data.name,
        },
      });
    }

    return ok(result);
  } catch (error) {
    return handleWhatsAppError(error, {
      operationName: 'integrations.createWhatsappTemplate',
      extra: { accountId: parsed.data.accountId, name: parsed.data.name },
      defaultUserTitle: 'Failed to Create WhatsApp Template',
      db,
      organizationId: parsed.data.organizationId,
    });
  }
};

export const createWhatsappTemplate = (
  db: DbConnection,
  input: CreateWhatsappTemplateInput
) =>
  trackedResult(
    'integrations.createWhatsappTemplate',
    () => withOrgScope((tx) => createWhatsappTemplateImpl(tx, input), { db }),
    {
      properties: {
        accountId: input.accountId,
        templateName: input.name,
      },
    }
  );

export type CreateWhatsappTemplateResult = Awaited<
  ReturnType<typeof createWhatsappTemplate>
>;
