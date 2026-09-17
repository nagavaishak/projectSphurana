import {
  type MessagingDestination,
  whatsappAccount,
} from '@borradh-workspace/database';
import { fetchWithRetry } from '@borradh-workspace/http';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import type { MetaAdsService } from '@borradh-workspace/integrations/meta-ads';
import { GRAPH_API_BASE } from '@borradh-workspace/integrations/shared';
import { createLogger } from '@borradh-workspace/observability';
// MetaAdsService is still used by validateInstagramProfile + validatePaymentMethod.
import { and, eq } from 'drizzle-orm';
import { isMetaFreeWhatsAppNumber } from '../../../integrations/services/_shared/is-meta-free-whatsapp-number.js';
import {
  type DbConnection,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { AdErrorCodes } from '../../models/index.js';
import { lookupWhatsAppForDestinations } from './lookup-whatsapp-for-destinations.js';

const logger = createLogger('MetaAds');

/**
 * Verify the linked Instagram account has a profile picture.
 *
 * Meta auto-expands placements via Advantage+ even when publisher_platforms
 * is set to ['facebook'] only. If the linked IG account has no profile photo,
 * Meta will reject the ad with a misleading error.
 *
 * Non-fatal: if we can't check, we let Meta handle it during ad creation.
 */
export const validateInstagramProfile = async (
  metaService: MetaAdsService,
  linkedInstagramAccountId: string | undefined | null,
  linkedInstagramUsername?: string | null
): Promise<Result<void>> => {
  if (!linkedInstagramAccountId) return ok(undefined);

  try {
    const igAccount = await metaService.getInstagramAccountInfo(
      linkedInstagramAccountId
    );
    if (!igAccount.hasProfilePicture) {
      return err(
        new FeatureError(
          AdErrorCodes.META_AD_CREATE_FAILED,
          `Your linked Instagram account (@${igAccount.username || linkedInstagramUsername || 'unknown'}) doesn't have a profile photo. Meta requires this even for Facebook-only ads because it may auto-expand to Instagram. Please add a profile picture on Instagram and try again.`
        )
      );
    }
  } catch (error) {
    // Non-fatal — if we can't check, let Meta handle it during ad creation
    logger.warn('Could not verify Instagram profile picture', {
      instagramAccountId: linkedInstagramAccountId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(undefined);
};

/**
 * Verify the ad account has a valid payment method.
 *
 * Meta rejects ad creation with code 100 / subcode 1359188 if missing.
 */
export const validatePaymentMethod = async (
  metaService: MetaAdsService
): Promise<Result<void>> => {
  const hasFunding = await metaService.hasPaymentMethod();
  if (!hasFunding) {
    return err(
      new FeatureError(
        AdErrorCodes.META_PAYMENT_METHOD_REQUIRED,
        'Your Meta Ad Account does not have a valid payment method. Please add a payment method in Meta Business Manager before launching ads.'
      )
    );
  }
  return ok(undefined);
};

/**
 * Preflight check for WhatsApp-bound ads. Runs before we try to resolve
 * or create the Meta ad set so users get a clear error instead of a
 * generic Meta API rejection.
 *
 * Verifies:
 *   1. The org has an active (non-expired) WhatsApp Business account.
 *      This is covered by lookupWhatsAppForDestinations and yields
 *      META_WHATSAPP_DISCONNECTED on failure.
 *   2. The selected Facebook Page is actually linked to that WABA in
 *      Meta. Meta anchors WhatsApp ads on the page→WABA linkage: launching
 *      against an unlinked page fails with a cryptic ad set error.
 *
 * No-ops when `destinations` doesn't include `whatsapp`.
 */
export const validateWhatsAppDestinationPrerequisites = async (
  db: DbConnection,
  organizationId: string,
  pageId: string,
  destinations: MessagingDestination[] | undefined | null
): Promise<Result<void>> => {
  if (!destinations || !destinations.includes('whatsapp')) {
    return ok(undefined);
  }

  const waResult = await lookupWhatsAppForDestinations(
    db,
    organizationId,
    destinations
  );
  if (!waResult.success) return waResult;

  // Meta-provided "555" free numbers cannot run click-to-WhatsApp ads.
  // Fail fast with a targeted error instead of Meta's cryptic rejection.
  if (waResult.data && isMetaFreeWhatsAppNumber(waResult.data.phoneNumber)) {
    return err(
      new FeatureError(
        AdErrorCodes.META_WHATSAPP_FREE_NUMBER_INELIGIBLE,
        'The connected WhatsApp number is a Meta-provided free number, which cannot be used for click-to-WhatsApp ads. Add a verified business phone number in WhatsApp Manager (Phone numbers → Add number → "Add a new number"), connect it in Settings → Integrations, and try again.'
      )
    );
  }

  const wabaId = waResult.data?.wabaId;
  if (!wabaId) {
    // Defensive — lookup returned ok(null) despite whatsapp being requested.
    return err(
      new FeatureError(
        AdErrorCodes.META_WHATSAPP_DISCONNECTED,
        'No active WhatsApp Business account is connected for this organization.'
      )
    );
  }

  // Read `whatsapp_business_account` using the WhatsApp OAuth token, not
  // the Meta Ads token. The Page-level `whatsapp_business_account` field
  // is only reliably returned to tokens that hold `whatsapp_business_management`,
  // which our Meta Ads user token does not. Using the Meta Ads token here
  // produces false "not linked" readings even when Business Manager shows
  // the linkage is in place.
  const waAccount = await db.query.whatsappAccount.findFirst({
    where: and(
      eq(whatsappAccount.organizationId, organizationId),
      eq(whatsappAccount.isActive, true)
    ),
    columns: { encryptedCredentials: true },
  });

  if (!waAccount?.encryptedCredentials) {
    // Already caught above by lookupWhatsAppForDestinations, but defensive.
    return ok(undefined);
  }

  let waToken: string;
  try {
    const creds = decryptCredentials(waAccount.encryptedCredentials) as {
      accessToken: string;
    };
    waToken = creds.accessToken;
  } catch (error) {
    logger.warn('Could not decrypt WhatsApp credentials for linkage check', {
      error: error instanceof Error ? error.message : String(error),
    });
    return ok(undefined);
  }

  try {
    const params = new URLSearchParams({
      fields: 'whatsapp_business_account',
      access_token: waToken,
    });
    const res = await fetchWithRetry(
      `${GRAPH_API_BASE}/${pageId}?${params.toString()}`
    );

    if (!res.ok) {
      // Non-fatal — let Meta's ad set creation surface the real error.
      const body = await res.text().catch(() => '');
      logger.warn('Could not verify page → WhatsApp linkage', {
        pageId,
        wabaId,
        status: res.status,
        body: body.slice(0, 500),
      });
      return ok(undefined);
    }

    const body = (await res.json()) as {
      whatsapp_business_account?: { id?: string };
    };
    const linked = body.whatsapp_business_account;

    if (!linked?.id) {
      return err(
        new FeatureError(
          AdErrorCodes.META_WHATSAPP_PHONE_NOT_LINKED,
          'The selected Facebook Page is not linked to your WhatsApp Business account. In Meta Business Manager → Business Settings → WhatsApp Accounts → [your WABA] → Connected Assets → Add Asset, select this Page and re-run your ad.'
        )
      );
    }

    if (linked.id !== wabaId) {
      return err(
        new FeatureError(
          AdErrorCodes.META_WHATSAPP_PHONE_NOT_LINKED,
          "The selected Facebook Page is linked to a different WhatsApp Business account than the one connected to Borradh. Link the page to your connected WhatsApp account in Business Manager, or reconnect WhatsApp using the page's WABA."
        )
      );
    }
  } catch (error) {
    // Non-fatal — if we can't reach Meta here, let the actual ad set
    // creation path surface the error. We still log it so regressions
    // in getPageInfo aren't silent.
    logger.warn('Could not verify page → WhatsApp linkage', {
      pageId,
      wabaId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok(undefined);
};
