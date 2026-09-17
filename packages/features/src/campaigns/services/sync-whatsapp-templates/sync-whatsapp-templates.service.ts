import {
  type WhatsappTemplate,
  whatsappAccount,
  whatsappTemplate,
  withOrgScope,
} from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import { handleWhatsAppError } from '../../../meta-ads/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { CampaignErrorCodes } from '../../models/index.js';
import {
  type SyncWhatsappTemplatesInput,
  syncWhatsappTemplatesSchema,
} from './sync-whatsapp-templates.schema.js';

/**
 * Campaign-side WhatsApp template catalogue, backed by the org's linked
 * WhatsApp Business Account.
 *
 * Templates are authored/approved on Meta; campaigns only need an accurate
 * local mirror (name, language, body, approval status) so the composer and
 * Claire can offer approved templates for business-initiated sends. This
 * service reads the `whatsapp_template` cache and, on `refresh` (or first
 * use, when the cache is empty), pulls the live list from the WABA via the
 * org's active linked account and upserts it.
 */

/** Meta template statuses → our whatsapp_template status enum. */
const META_STATUS_MAP: Record<string, WhatsappTemplate['status']> = {
  APPROVED: 'approved',
  REJECTED: 'rejected',
  PAUSED: 'paused',
  DISABLED: 'disabled',
};

const toLocalStatus = (metaStatus: string): WhatsappTemplate['status'] =>
  META_STATUS_MAP[metaStatus.toUpperCase()] ?? 'pending';

export interface SyncWhatsappTemplatesData {
  templates: WhatsappTemplate[];
  /** True when this call refreshed from Meta (vs a pure cache read). */
  synced: boolean;
}

const syncWhatsappTemplatesImpl = async (
  db: DbConnection,
  input: SyncWhatsappTemplatesInput
): Promise<Result<SyncWhatsappTemplatesData>> => {
  const parsed = syncWhatsappTemplatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, refresh } = parsed.data;

  const readCache = () =>
    db.query.whatsappTemplate.findMany({
      where: eq(whatsappTemplate.organizationId, organizationId),
      orderBy: [asc(whatsappTemplate.name), asc(whatsappTemplate.languageCode)],
    });

  const cached = await readCache();
  if (!refresh && cached.length > 0) {
    return ok({ templates: cached, synced: false });
  }

  const account = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.organizationId, organizationId),
      eq(whatsappAccount.isActive, true)
    ),
  });
  if (!account) {
    // No linked WABA: a plain read is still fine (empty or stale cache), but
    // an explicit refresh should tell the caller why nothing can sync.
    if (!refresh) return ok({ templates: cached, synced: false });
    return err(
      new FeatureError(
        CampaignErrorCodes.CHANNEL_NOT_CONFIGURED,
        'No active WhatsApp Business account is connected for this organization'
      )
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
    const remote = await client.listTemplates(account.wabaId);

    const now = new Date();
    for (const t of remote) {
      const body =
        t.components.find((c) => c.type.toUpperCase() === 'BODY')?.text ?? '';
      await db
        .insert(whatsappTemplate)
        .values({
          organizationId,
          name: t.name,
          languageCode: t.language,
          category: t.category,
          status: toLocalStatus(t.status),
          body,
          metaTemplateId: t.id,
          syncedAt: now,
        })
        .onConflictDoUpdate({
          target: [
            whatsappTemplate.organizationId,
            whatsappTemplate.name,
            whatsappTemplate.languageCode,
          ],
          set: {
            category: t.category,
            status: toLocalStatus(t.status),
            body,
            metaTemplateId: t.id,
            syncedAt: now,
          },
        });
    }

    return ok({ templates: await readCache(), synced: true });
  } catch (error) {
    // This is the same Meta Graph API request used by the integrations
    // settings page. Normalize its failures through the shared handler so a
    // revoked token marks the linked account as needing reconnection and is
    // returned as an actionable 4xx rather than a generic 500/Sentry error.
    return handleWhatsAppError(error, {
      operationName: 'campaigns.syncWhatsappTemplates',
      extra: { accountId: account.id },
      defaultUserTitle: 'Failed to Sync WhatsApp Templates',
      db,
      organizationId,
    });
  }
};

export const syncWhatsappTemplates = (
  db: DbConnection,
  input: SyncWhatsappTemplatesInput
) =>
  trackedResult(
    'campaigns.syncWhatsappTemplates',
    () => withOrgScope((tx) => syncWhatsappTemplatesImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type SyncWhatsappTemplatesResult = Awaited<
  ReturnType<typeof syncWhatsappTemplates>
>;
