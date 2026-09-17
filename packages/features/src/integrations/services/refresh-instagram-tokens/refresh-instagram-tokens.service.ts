import { instagramIntegration } from '@borradh-workspace/database';
import {
  InstagramOAuthService,
  decryptCredentials,
  encryptCredentials,
  isMetaAuthError,
} from '@borradh-workspace/integrations';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, lt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { markInstagramNeedsReconnect } from '../mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type RefreshInstagramTokensInput,
  refreshInstagramTokensSchema,
} from './refresh-instagram-tokens.schema.js';

export interface RefreshInstagramTokensResult {
  refreshed: number;
  failed: number;
  skipped: number;
  errors: Array<{ organizationId: string; message: string }>;
}

const refreshInstagramTokensImpl = async (
  db: DbConnection,
  input: RefreshInstagramTokensInput
): Promise<Result<RefreshInstagramTokensResult>> => {
  const parsed = refreshInstagramTokensSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { daysBeforeExpiry } = parsed.data;
  const now = new Date();
  const expiryThreshold = new Date(
    now.getTime() + daysBeforeExpiry * 24 * 60 * 60 * 1000
  );

  // Find active integrations with tokens expiring before the threshold
  const integrations = await db.query.instagramIntegration.findMany({
    where: and(
      eq(instagramIntegration.isActive, true),
      lt(instagramIntegration.tokenExpiresAt, expiryThreshold)
    ),
  });

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ organizationId: string; message: string }> = [];

  const oauthService = new InstagramOAuthService();

  for (const integration of integrations) {
    // Skip already-expired tokens — they can't be refreshed
    if (
      integration.tokenExpiresAt &&
      integration.tokenExpiresAt.getTime() < now.getTime()
    ) {
      skipped++;
      continue;
    }

    try {
      if (!integration.encryptedCredentials) {
        skipped++;
        continue;
      }

      const decrypted = decryptCredentials<{ accessToken: string }>(
        integration.encryptedCredentials
      );

      const newToken = await oauthService.refreshLongLivedToken(
        decrypted.accessToken
      );

      const newExpiresAt = newToken.expiresIn
        ? new Date(now.getTime() + newToken.expiresIn * 1000)
        : null;

      const newEncrypted = encryptCredentials({
        accessToken: newToken.accessToken,
        instagramUserId: integration.instagramUserId,
      });

      await db
        .update(instagramIntegration)
        .set({
          encryptedCredentials: newEncrypted,
          tokenExpiresAt: newExpiresAt,
        })
        .where(eq(instagramIntegration.id, integration.id));

      refreshed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ organizationId: integration.organizationId, message });

      // If the token is permanently invalid, mark integration for reconnection.
      // This is an expected condition (user revoked access, password changed,
      // etc.) — don't escalate to Sentry.
      if (isMetaAuthError(error)) {
        await markInstagramNeedsReconnect(db, integration.organizationId);
        continue;
      }

      logError('integrations.refreshInstagramTokens', error, {
        feature: 'integrations',
        extra: { organizationId: integration.organizationId },
      });
    }
  }

  return ok({ refreshed, failed, skipped, errors });
};

export const refreshInstagramTokens = (
  db: DbConnection,
  input: RefreshInstagramTokensInput = { daysBeforeExpiry: 7 }
) =>
  trackedResult(
    'integrations.refreshInstagramTokens',
    () => refreshInstagramTokensImpl(db, input),
    {
      properties: { daysBeforeExpiry: input.daysBeforeExpiry },
      trackSuccess: false,
      trackFailure: false,
    }
  );

export type RefreshInstagramTokensServiceResult = Awaited<
  ReturnType<typeof refreshInstagramTokens>
>;
