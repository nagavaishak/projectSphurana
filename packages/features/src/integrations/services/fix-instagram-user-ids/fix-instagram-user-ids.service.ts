import { instagramIntegration } from '@borradh-workspace/database';
import {
  InstagramOAuthService,
  decryptCredentials,
} from '@borradh-workspace/integrations';
import type { InstagramCredentials } from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';

export interface FixResult {
  total: number;
  fixed: number;
  skipped: number;
  errors: number;
  details: Array<{
    id: string;
    organizationId: string;
    name: string | null;
    oldId: string | null;
    newId: string | null;
    status: 'fixed' | 'skipped' | 'error';
    reason?: string;
  }>;
}

/**
 * One-time fix: correct instagram_user_id for all active integrations.
 *
 * ## Background
 *
 * The Instagram Login API returns two different user IDs:
 *
 *   - `profile.id`       — App-scoped ID. Unique per app, stable across sessions.
 *                           This is what most OAuth flows return first.
 *   - `profile.user_id`  — Instagram-scoped ID (also called IGBA). This is the
 *                           ID Meta uses as `recipient.id` in webhook payloads.
 *
 * ## The Bug
 *
 * `connectInstagram` was storing `profile.id` (app-scoped) in the
 * `instagram_user_id` DB column. When a webhook arrived, it carried the IGBA
 * as `recipient.id`. The lookup (`WHERE instagram_user_id = <webhook recipient>`)
 * failed because the stored value was the wrong type of ID.
 *
 * The fallback logic in `resolveStandaloneInstagramContext` then picked the
 * first active integration it could find and backfilled the IGBA onto it —
 * which, with multiple orgs, meant webhooks got routed to the wrong org.
 *
 * ## The Fix (two parts)
 *
 * 1. `connectInstagram` now stores `profile.user_id` (IGBA) instead of
 *    `profile.id`. New connections will have the correct ID from the start.
 *
 * 2. This service fixes existing integrations. For each active integration it:
 *    a. Decrypts the stored access token
 *    b. Calls the Instagram Graph API (`/me?fields=user_id,...`) to get the
 *       correct IGBA for that token
 *    c. Compares the stored `instagram_user_id` with the API's `user_id`
 *    d. If different, updates the DB column to the correct IGBA
 *
 * ## Usage
 *
 * Call `POST /integrations/instagram/fix-user-ids` (authenticated).
 * This is idempotent — integrations already storing the correct IGBA are
 * skipped. The response includes a per-integration breakdown of what was
 * fixed, skipped, or errored (e.g. expired token).
 *
 * After running this, all webhook recipient IDs will match their integration
 * records directly, eliminating the need for the dangerous fallback path.
 */
const fixInstagramUserIdsImpl = async (
  db: DbConnection
): Promise<Result<FixResult>> => {
  const igOAuth = new InstagramOAuthService();

  const integrations = await db.query.instagramIntegration.findMany({
    where: eq(instagramIntegration.isActive, true),
  });

  const result: FixResult = {
    total: integrations.length,
    fixed: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  for (const integration of integrations) {
    try {
      if (!integration.encryptedCredentials) {
        result.skipped++;
        result.details.push({
          id: integration.id,
          organizationId: integration.organizationId,
          name: integration.name,
          oldId: integration.instagramUserId,
          newId: null,
          status: 'skipped',
          reason: 'No encrypted credentials',
        });
        continue;
      }

      // Decrypt the stored access token
      const creds = decryptCredentials<InstagramCredentials>(
        integration.encryptedCredentials
      );

      // Call Instagram API to get the correct user_id (IGBA)
      const profile = await igOAuth.getUserProfile(creds.accessToken);

      // profile.user_id is the Instagram-scoped ID (IGBA)
      // profile.id is the app-scoped ID
      if (integration.instagramUserId === profile.user_id) {
        result.skipped++;
        result.details.push({
          id: integration.id,
          organizationId: integration.organizationId,
          name: integration.name,
          oldId: integration.instagramUserId,
          newId: null,
          status: 'skipped',
          reason: 'Already correct',
        });
        continue;
      }

      // Update to the correct IGBA
      await db
        .update(instagramIntegration)
        .set({ instagramUserId: profile.user_id })
        .where(eq(instagramIntegration.id, integration.id));

      result.fixed++;
      result.details.push({
        id: integration.id,
        organizationId: integration.organizationId,
        name: integration.name,
        oldId: integration.instagramUserId,
        newId: profile.user_id,
        status: 'fixed',
      });
    } catch (error) {
      logError('integrations.fixInstagramUserIds', error, {
        feature: 'integrations',
        extra: {
          integrationId: integration.id,
          organizationId: integration.organizationId,
        },
      });

      result.errors++;
      result.details.push({
        id: integration.id,
        organizationId: integration.organizationId,
        name: integration.name,
        oldId: integration.instagramUserId,
        newId: null,
        status: 'error',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  return ok(result);
};

export const fixInstagramUserIds = (db: DbConnection) =>
  trackedResult(
    'integrations.fixInstagramUserIds',
    () => fixInstagramUserIdsImpl(db),
    {}
  );

export type FixInstagramUserIdsResult = Awaited<
  ReturnType<typeof fixInstagramUserIds>
>;
