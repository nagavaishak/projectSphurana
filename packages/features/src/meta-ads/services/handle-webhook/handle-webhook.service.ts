import { createHmac, timingSafeEqual } from 'node:crypto';
import { metaAd } from '@borradh-workspace/database';
import { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
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
  getMetaCredentials,
  logMetaErrorIfUnknown,
  mapMetaAdStatus,
} from '../_shared/index.js';
import {
  type HandleWebhookInput,
  adStatusChangeSchema,
  campaignStatusChangeSchema,
  handleWebhookSchema,
} from './handle-webhook.schema.js';

const logger = createLogger('MetaWebhook');

/**
 * Verify Meta webhook signature
 */
const verifySignature = (
  signature: string,
  rawBody: string,
  appSecret: string
): boolean => {
  const expectedSignature = createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  // Signature format is usually "sha256=<hash>"
  const providedHash = signature.startsWith('sha256=')
    ? signature.slice(7)
    : signature;

  const aBuf = Buffer.from(expectedSignature);
  const bBuf = Buffer.from(providedHash);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
};

/**
 * Sync full ad data from Meta
 */
const syncAdFromMeta = async (
  db: DbConnection,
  metaAdId: string
): Promise<boolean> => {
  // Find the ad by Meta ID
  const ad = await db.query.metaAd.findFirst({
    where: eq(metaAd.metaAdId, metaAdId),
  });

  if (!ad) {
    logger.debug(`Ad ${metaAdId} not found in database, skipping`);
    return false;
  }

  // Get credentials using ad's organizationId directly
  const credResult = await getMetaCredentials(db, {
    organizationId: ad.organizationId,
  });
  if (!credResult.success) {
    logger.warn(`No credentials for org ${ad.organizationId}`);
    return false;
  }

  try {
    const metaService = new MetaAdsService(credResult.data.credentials);
    const metaData = await metaService.getAd(metaAdId);

    // If Meta reports the ad as DELETED, remove it locally
    if (metaData.effectiveStatus === 'DELETED') {
      await db.delete(metaAd).where(eq(metaAd.id, ad.id));
      logger.info(`Ad ${ad.id} deleted (Meta status: DELETED)`);
      return true;
    }

    // Update ad with full data from Meta
    const newStatus = mapMetaAdStatus(metaData.effectiveStatus);

    await db
      .update(metaAd)
      .set({
        name: metaData.name,
        status: newStatus,
        metaStatus: metaData.effectiveStatus,
        lastSyncAt: new Date(),
        syncError: null,
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, ad.id));

    logger.info(`Synced ad ${ad.id} from Meta`, {
      metaAdId,
      name: metaData.name,
      status: newStatus,
    });

    return true;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error';

    // Check if ad was deleted
    if (
      errorMessage.includes('does not exist') ||
      errorMessage.includes('deleted')
    ) {
      // Delete the ad locally since it's gone from Meta
      await db.delete(metaAd).where(eq(metaAd.id, ad.id));

      logger.info(`Ad ${ad.id} deleted (removed from Meta)`);
      return true;
    }

    logMetaErrorIfUnknown('metaWebhook.syncAd', error, {
      metaAdId,
      adId: ad.id,
    });

    // Store error but don't fail
    await db
      .update(metaAd)
      .set({
        syncError: errorMessage,
        lastSyncAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(metaAd.id, ad.id));

    return false;
  }
};

/**
 * Handle campaign change from webhook
 * Since we no longer store campaigns locally, we just log the change.
 * Campaign data is always fetched live from Meta API.
 */
const handleCampaignChange = async (
  _db: DbConnection,
  change: { campaign_id: string; effective_status?: string; deleted?: boolean }
): Promise<boolean> => {
  logger.debug('Campaign change received (no local sync needed)', {
    campaignId: change.campaign_id,
    status: change.effective_status,
    deleted: change.deleted,
  });

  // No local campaign table to update - campaigns are fetched live from Meta
  return true;
};

/**
 * Handle ad change from webhook - triggers full sync
 */
const handleAdChange = async (
  db: DbConnection,
  change: { ad_id: string; effective_status?: string; deleted?: boolean }
): Promise<boolean> => {
  logger.debug('Processing ad change', {
    adId: change.ad_id,
    status: change.effective_status,
    deleted: change.deleted,
  });

  // If explicitly deleted or effective_status is DELETED, remove locally
  if (change.deleted || change.effective_status === 'DELETED') {
    const ad = await db.query.metaAd.findFirst({
      where: eq(metaAd.metaAdId, change.ad_id),
    });

    if (ad) {
      await db.delete(metaAd).where(eq(metaAd.id, ad.id));
      logger.info(
        `Ad ${ad.id} deleted (webhook: deleted=${change.deleted}, status=${change.effective_status})`
      );
      return true;
    }
    return false;
  }

  // For any other change, do a full sync from Meta
  return syncAdFromMeta(db, change.ad_id);
};

/**
 * Internal implementation
 */
const handleWebhookImpl = async (
  db: DbConnection,
  input: HandleWebhookInput,
  appSecret: string
): Promise<Result<{ processed: number; synced: number }>> => {
  // Validate input
  const parsed = handleWebhookSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid webhook payload', {
        issues: parsed.error.issues,
      })
    );
  }

  const { payload, signature, rawBody } = parsed.data;

  // Verify signature
  if (!verifySignature(signature, rawBody, appSecret)) {
    return err(
      new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid webhook signature')
    );
  }

  let processed = 0;
  let synced = 0;

  // Process each entry
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      try {
        switch (change.field) {
          case 'ads': {
            const adChange = adStatusChangeSchema.safeParse(change.value);
            if (adChange.success) {
              processed++;
              const wasSynced = await handleAdChange(db, {
                ad_id: adChange.data.ad_id,
                effective_status: adChange.data.effective_status,
                deleted: adChange.data.deleted,
              });
              if (wasSynced) synced++;
            }
            break;
          }

          case 'campaigns': {
            const campaignChange = campaignStatusChangeSchema.safeParse(
              change.value
            );
            if (campaignChange.success) {
              processed++;
              const wasSynced = await handleCampaignChange(db, {
                campaign_id: campaignChange.data.campaign_id,
                effective_status: campaignChange.data.effective_status,
                deleted: campaignChange.data.deleted,
              });
              if (wasSynced) synced++;
            }
            break;
          }

          case 'adsets': {
            logger.debug('Ad set change received', { value: change.value });
            processed++;
            break;
          }

          case 'ad_account': {
            logger.debug('Ad account change received', { value: change.value });
            processed++;
            break;
          }

          default:
            logger.debug(`Unknown webhook field: ${change.field}`);
            break;
        }
      } catch (error) {
        // Continue processing other changes
        logMetaErrorIfUnknown('metaWebhook.processChange', error, {
          field: change.field,
          value: change.value,
        });
      }
    }
  }

  logger.info('Webhook processed', { processed, synced });
  return ok({ processed, synced });
};

/**
 * Handle Meta webhook events
 */
export const handleWebhook = (
  db: DbConnection,
  input: HandleWebhookInput,
  appSecret: string
) =>
  trackedResult(
    'metaAds.handleWebhook',
    () => handleWebhookImpl(db, input, appSecret),
    {
      properties: { hasSignature: !!input.signature },
    }
  );

/**
 * Result type for handleWebhook
 */
export type HandleWebhookResult = Awaited<ReturnType<typeof handleWebhook>>;

/**
 * Verify webhook challenge (for webhook registration)
 * Meta sends a verification request when setting up webhooks
 */
export const verifyWebhookChallenge = (
  mode: string,
  token: string,
  challenge: string,
  verifyToken: string
): string | null => {
  if (mode !== 'subscribe') return null;
  const aBuf = Buffer.from(token);
  const bBuf = Buffer.from(verifyToken);
  if (aBuf.length !== bBuf.length) return null;
  if (!timingSafeEqual(aBuf, bBuf)) return null;
  return challenge;
};
