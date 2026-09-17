// Create ad
export {
  createAd,
  createAdSchema,
  adTargetingOverrideSchema,
  type CreateAdInput,
  type CreateAdResult,
} from './create-ad/index.js';

// Ensure / backfill local campaign config for imported (previously-ran) campaigns
export {
  ensureCampaignConfig,
  backfillCampaignConfigs,
  ensureCampaignConfigSchema,
  backfillCampaignConfigsSchema,
  type EnsureCampaignConfigInput,
  type BackfillCampaignConfigsInput,
  type BackfillCampaignConfigsData,
} from './ensure-campaign-config/index.js';

// Duplicate ad (Meta /copies edge)
export {
  duplicateAd,
  duplicateAdSchema,
  type DuplicateAdInput,
  type DuplicateAdResult,
} from './duplicate-ad/index.js';

// Get ad
export {
  getAd,
  getAdSchema,
  type GetAdInput,
  type GetAdResult,
} from './get-ad/index.js';

// List ads
export {
  listAds,
  listAdsSchema,
  type ListAdsInput,
  type ListAdsResult,
} from './list-ads/index.js';

// Update ad
export {
  updateAd,
  updateAdSchema,
  type UpdateAdInput,
  type UpdateAdResult,
} from './update-ad/index.js';

// Replace the creative on an unpublished local draft without creating a new ad.
export {
  replaceAdCreative,
  replaceAdCreativeRequestSchema,
  replaceAdCreativeSchema,
  type ReplaceAdCreativeInput,
  type ReplaceAdCreativeResult,
} from './replace-ad-creative/index.js';

// Delete ad
export {
  deleteAd,
  deleteAdSchema,
  type DeleteAdInput,
  type DeleteAdResult,
} from './delete-ad/index.js';

// Launch ad (create + publish in one step)
export {
  launchAd,
  launchAdSchema,
  type LaunchAdInput,
  type LaunchAdResult,
  type LaunchAdResponse,
} from './launch-ad/index.js';

// Webhook acknowledgement (what POST /meta-ads/webhook should reply)
export {
  acknowledgeMetaAdsWebhook,
  type MetaAdsWebhookAck,
  type AcknowledgeMetaAdsWebhookInput,
} from './acknowledge-webhook/index.js';

// Launch ad and kick off background finalization (the API's launch route)
export {
  launchAndFinalizeAd,
  type LaunchAndFinalizeAdResult,
} from './launch-and-finalize-ad/index.js';

// Launch ad from existing post (boost post)
export {
  launchAdFromPost,
  launchAdFromPostSchema,
  type LaunchAdFromPostInput,
  type LaunchAdFromPostResult,
  type LaunchAdFromPostResponse,
} from './launch-ad-from-post/index.js';

// Publish ad (publish existing draft)
export {
  publishAd,
  publishAdSchema,
  type PublishAdInput,
  type PublishAdResult,
} from './publish-ad/index.js';

// Handle Meta webhooks
export {
  handleWebhook,
  verifyWebhookChallenge,
  handleWebhookSchema,
  metaWebhookSchema,
  adStatusChangeSchema,
  campaignStatusChangeSchema,
  type HandleWebhookResult,
  type HandleWebhookInput,
  type MetaWebhookPayload,
  type AdStatusChange,
  type CampaignStatusChange,
} from './handle-webhook/index.js';

// Finalize ad (background processing after launch)
export { finalizeAd } from './finalize-ad/index.js';

// Sync from Meta (manual sync)
export {
  syncAdStatus,
  syncAdStatusSchema,
  type SyncAdStatusResult,
  type SyncAdStatusInput,
} from './sync-from-meta/index.js';

// Sync all ads from Meta (bulk sync)
export {
  syncAllAds,
  syncAllAdsSchema,
  type SyncAllAdsInput,
  type SyncAllAdsResult,
} from './sync-all-ads/index.js';

// Health check (pre-launch validation)
export {
  healthCheck,
  healthCheckSchema,
  type HealthCheckInput,
  type HealthCheckResult,
  type HealthCheckItem,
  type HealthCheckStatus,
} from './health-check/index.js';

// Import existing ads from Meta
export {
  importMetaAds,
  importMetaAdsSchema,
  type ImportMetaAdsData,
  type ImportMetaAdsInput,
  type ImportMetaAdsResult,
} from './import-meta-ads/index.js';

// Lazy single-ad import on CTM/CTWA referral miss (resolves adInternalId)
export {
  importAdById,
  importAdByIdSchema,
  type ImportAdByIdData,
  type ImportAdByIdInput,
  type ImportAdByIdResult,
} from './import-ad-by-id/index.js';

// Proactive health alerts (billing, auth, account status)
export {
  runHealthAlerts,
  runHealthAlertsSchema,
  type RunHealthAlertsInput,
  type RunHealthAlertsResult,
} from './run-health-alerts/index.js';

// Lead-form nurturing channel resolution (country → Messenger/WhatsApp)
export {
  resolveNurtureChannel,
  type NurtureChannel,
  type ResolveNurtureChannelInput,
  type ResolveNurtureChannelResult,
} from './_shared/nurture-channel-for-country.js';

// Media-asset resolution (creative id → fetchable URL). Consumed by the
// WhatsApp turn renderer to mint owner-authorized media links for previews.
export {
  resolveMediaAsset,
  type ResolvedMediaAsset,
} from './_shared/resolve-media-asset.js';
export { getFreshDownloadUrl } from './_shared/get-fresh-download-url.js';

// Post-mutation read-back of ad + parent-campaign state (ADR-005 honest-state
// union). Launch/pause/resume/budget paths report THIS, never their intent.
export {
  verifyAdLaunchState,
  localStatusForLaunchState,
  verifyAdLaunchStateSchema,
  adLaunchStateValues,
  type AdLaunchState,
  type VerifyAdLaunchStateData,
  type VerifyAdLaunchStateInput,
  type VerifyAdLaunchStateResult,
} from './verify-ad-launch-state/index.js';
// Credential resolution — public because sibling contexts (microsites' pixel
// and CAPI work) legitimately need the org's Meta credentials, and reaching
// into `_shared/` for them is exactly the deep import the cross-context gate
// rejects.
export { getMetaCredentials } from './_shared/index.js';
// Meta Graph error normalization — public for the same reason: WhatsApp Cloud
// API rides the same error envelope, so `integrations`, `campaigns` and
// `sequences` all normalize their failures through this one handler.
export {
  handleWhatsAppError,
  type HandleWhatsAppErrorOptions,
} from './_shared/handle-whatsapp-error.js';
