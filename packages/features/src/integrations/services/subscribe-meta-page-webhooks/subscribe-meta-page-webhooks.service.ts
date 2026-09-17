import { metaAdsPage } from '@borradh-workspace/database';
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';
import { MetaMessagingService } from '@borradh-workspace/integrations/meta-messaging';
import { metaPageSubscribedFields } from '@borradh-workspace/integrations/webhooks';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';

import type { DbConnection } from '../../../shared/index.js';
import { type Result, ok } from '../../../shared/index.js';

const logger = createLogger('SubscribeMetaPageWebhooks');

export interface SubscribeMetaPageResult {
  total: number;
  subscribed: number;
  failed: number;
  skipped: number;
  details: Array<{
    pageName: string;
    pageId: string;
    status: 'subscribed' | 'failed' | 'skipped';
    error?: string;
  }>;
}

/**
 * Re-POST `subscribed_fields` for every active Facebook Page.
 *
 * Meta stores the field list per (page, app) at subscribe time — it is NOT
 * re-read from our config. So adding a field to `metaPageSubscribedFields`
 * only reaches pages connected AFTER the deploy; every existing page keeps the
 * list it was subscribed with. This backfill closes that gap, and is
 * idempotent: POSTing `subscribed_apps` again just overwrites the list.
 *
 * Written for ENG-813, where `message_echoes` had never been subscribed at
 * all, so Messenger agent-takeover was dead for every existing page — a clinic
 * owner replying from Meta's own inbox never stood the bot down. Deploying the
 * registry change without running this fixes nothing for anyone already live.
 *
 * Direct sibling of `subscribeInstagramWebhooks`, which exists for the same
 * reason on the Instagram side.
 */
const subscribeMetaPageWebhooksImpl = async (
  db: DbConnection
): Promise<Result<SubscribeMetaPageResult>> => {
  const pages = await db.query.metaAdsPage.findMany({
    where: eq(metaAdsPage.isActive, true),
  });

  logger.info(`Found ${pages.length} active Meta pages`);

  const result: SubscribeMetaPageResult = {
    total: pages.length,
    subscribed: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  for (const page of pages) {
    const pageName = page.pageName ?? page.pageId;

    if (!page.pageAccessToken) {
      logger.warn(`Skipping ${pageName}: no page access token`);
      result.skipped++;
      result.details.push({
        pageName,
        pageId: page.pageId,
        status: 'skipped',
        error: 'no page access token',
      });
      continue;
    }

    try {
      const decrypted = decryptCredentials<{ accessToken: string }>(
        page.pageAccessToken
      );

      const messenger = new MetaMessagingService({
        pageAccessToken: decrypted.accessToken,
        pageId: page.pageId,
      });

      await messenger.subscribeToMessaging();

      logger.info(`Subscribed ${pageName} (${page.pageId})`);
      result.subscribed++;
      result.details.push({
        pageName,
        pageId: page.pageId,
        status: 'subscribed',
      });
    } catch (error) {
      // One page with an expired token must not abort the run — the whole
      // point is to reach every page we still can.
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to subscribe ${pageName}: ${message}`);
      logError('integrations.subscribeMetaPageWebhooks', error, {
        feature: 'integrations',
        extra: { pageName, pageId: page.pageId, metaAdsPageId: page.id },
      });
      result.failed++;
      result.details.push({
        pageName,
        pageId: page.pageId,
        status: 'failed',
        error: message,
      });
    }
  }

  logger.info(
    `Done: ${result.subscribed} subscribed, ${result.failed} failed, ${result.skipped} skipped`
  );

  return ok(result);
};

/**
 * Wrapped in `trackedResult` per `.claude/rules/features/service.md`.
 *
 * This backfill IS the production remedy for ENG-813 — until it runs, the
 * registry change reaches no existing clinic. A run that half-fails (an
 * expired page token, a bad INTEGRATION_ENCRYPTION_KEY) otherwise leaves its
 * only trace in whoever's terminal scrollback, and the pages it missed stay
 * deaf to echoes with nothing in Sentry or PostHog to say so. The per-page
 * `logError` calls inside cover individual failures; this covers the run.
 */
export const subscribeMetaPageWebhooks = (db: DbConnection) =>
  trackedResult(
    'integrations.subscribeMetaPageWebhooks',
    () => subscribeMetaPageWebhooksImpl(db),
    {
      properties: { subscribedFields: metaPageSubscribedFields.join(',') },
    }
  );

export type SubscribeMetaPageWebhooksResult = Awaited<
  ReturnType<typeof subscribeMetaPageWebhooks>
>;
