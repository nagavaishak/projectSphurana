import { instagramIntegration } from '@borradh-workspace/database';
import {
  InstagramOAuthService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import { createLogger, logError } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';

import type { DbConnection } from '../../../shared/index.js';
import { type Result, ok } from '../../../shared/index.js';

const logger = createLogger('SubscribeInstagramWebhooks');

export interface SubscribeResult {
  total: number;
  subscribed: number;
  failed: number;
  skipped: number;
  details: Array<{
    username: string;
    status: 'subscribed' | 'failed' | 'skipped';
    error?: string;
  }>;
}

/**
 * Subscribe all active Instagram integrations to messaging webhooks.
 * This is a one-time migration for accounts connected before the
 * subscribeToWebhooks step was added to the connect flow.
 */
const subscribeInstagramWebhooksImpl = async (
  db: DbConnection
): Promise<Result<SubscribeResult>> => {
  const integrations = await db.query.instagramIntegration.findMany({
    where: eq(instagramIntegration.isActive, true),
  });

  logger.info(`Found ${integrations.length} active Instagram integrations`);

  const result: SubscribeResult = {
    total: integrations.length,
    subscribed: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const igOAuth = new InstagramOAuthService();

  for (const integration of integrations) {
    const username = integration.username ?? integration.id;

    if (!integration.encryptedCredentials) {
      logger.warn(`Skipping ${username}: no encrypted credentials`);
      result.skipped++;
      result.details.push({
        username,
        status: 'skipped',
        error: 'no credentials',
      });
      continue;
    }

    if (integration.tokenStatus !== 'valid') {
      logger.warn(
        `Skipping ${username}: token status is ${integration.tokenStatus}`
      );
      result.skipped++;
      result.details.push({
        username,
        status: 'skipped',
        error: `token ${integration.tokenStatus}`,
      });
      continue;
    }

    try {
      const decrypted = decryptCredentials<{ accessToken: string }>(
        integration.encryptedCredentials
      );

      await igOAuth.subscribeToWebhooks(decrypted.accessToken);
      logger.info(`Subscribed ${username} to webhooks`);
      result.subscribed++;
      result.details.push({ username, status: 'subscribed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error(`Failed to subscribe ${username}: ${message}`);
      logError('integrations.subscribeInstagramWebhooks', error, {
        feature: 'integrations',
        extra: { username, integrationId: integration.id },
      });
      result.failed++;
      result.details.push({ username, status: 'failed', error: message });
    }
  }

  logger.info(
    `Done: ${result.subscribed} subscribed, ${result.failed} failed, ${result.skipped} skipped`
  );

  return ok(result);
};

export const subscribeInstagramWebhooks = (db: DbConnection) =>
  subscribeInstagramWebhooksImpl(db);

export type SubscribeInstagramWebhooksResult = Awaited<
  ReturnType<typeof subscribeInstagramWebhooks>
>;
