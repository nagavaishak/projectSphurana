import { createLogger } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';

import type { AdReferralInput } from './resolve-ad-referral.js';

const logger = createLogger('PendingAdReferral');

/** TTL in seconds — referral is valid for 5 minutes after the standalone event. */
const PENDING_REFERRAL_TTL = 300;

function buildKey(pageId: string, senderId: string, platform: string): string {
  return `pending-ad-referral:${platform}:${pageId}:${senderId}`;
}

/**
 * Store ad referral data in Redis so it can be picked up when the first
 * message arrives (standalone referral events arrive before the message).
 */
export async function storePendingAdReferral(
  pageId: string,
  senderId: string,
  platform: string,
  referral: AdReferralInput
): Promise<void> {
  try {
    const redis = getRedis();
    const key = buildKey(pageId, senderId, platform);
    await redis.set(key, JSON.stringify(referral), 'EX', PENDING_REFERRAL_TTL);
    logger.info('Stored pending ad referral', {
      pageId,
      senderId,
      platform,
      metaAdId: referral.metaAdId,
    });
  } catch (error) {
    // Non-critical — worst case the referral won't be picked up
    logger.warn('Failed to store pending ad referral', {
      pageId,
      senderId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Retrieve and delete a pending ad referral from Redis.
 * Returns null if none exists.
 */
export async function consumePendingAdReferral(
  pageId: string,
  senderId: string,
  platform: string
): Promise<AdReferralInput | null> {
  try {
    const redis = getRedis();
    const key = buildKey(pageId, senderId, platform);
    const raw = await redis.get(key);
    if (!raw) return null;

    // Delete after reading so it's only used once
    await redis.del(key);

    const referral = JSON.parse(raw) as AdReferralInput;
    logger.info('Consumed pending ad referral', {
      pageId,
      senderId,
      platform,
      metaAdId: referral.metaAdId,
    });
    return referral;
  } catch (error) {
    logger.warn('Failed to consume pending ad referral', {
      pageId,
      senderId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
