import { metaAdsIntegration } from '@borradh-workspace/database';
import {
  decryptCredentials,
  encryptCredentials,
  isMetaAuthError,
} from '@borradh-workspace/integrations';
import { MetaOAuthService } from '@borradh-workspace/integrations/meta-ads';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  isFlfbIntegration,
  ok,
} from '../../../shared/index.js';
import { markMetaAdsNeedsReconnect } from '../mark-needs-reconnect/mark-needs-reconnect.service.js';
import {
  type RefreshMetaTokensInput,
  refreshMetaTokensSchema,
} from './refresh-meta-tokens.schema.js';

export interface RefreshMetaTokensResult {
  refreshed: number;
  failed: number;
  skipped: number;
  errors: Array<{ organizationId: string; message: string }>;
}

const refreshMetaTokensImpl = async (
  db: DbConnection,
  input: RefreshMetaTokensInput
): Promise<Result<RefreshMetaTokensResult>> => {
  const parsed = refreshMetaTokensSchema.safeParse(input);
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

  // Find active, configured integrations with tokens expiring before the
  // threshold. tokenExpiresAt IS NULL means an FLfB system-user token — those
  // never expire and must NEVER be sent through fb_exchange_token, so they are
  // excluded explicitly (not just by SQL null-comparison semantics).
  const integrations = await db.query.metaAdsIntegration.findMany({
    where: and(
      eq(metaAdsIntegration.isActive, true),
      eq(metaAdsIntegration.configurationStatus, 'configured'),
      isNotNull(metaAdsIntegration.tokenExpiresAt),
      lt(metaAdsIntegration.tokenExpiresAt, expiryThreshold)
    ),
  });

  let refreshed = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ organizationId: string; message: string }> = [];

  const oauthService = new MetaOAuthService();

  for (const integration of integrations) {
    // Belt-and-braces: never refresh a non-expiring FLfB system-user token
    if (isFlfbIntegration(integration) || !integration.tokenExpiresAt) {
      skipped++;
      continue;
    }

    // Skip already-expired tokens — they can't be refreshed
    if (integration.tokenExpiresAt.getTime() < now.getTime()) {
      skipped++;
      continue;
    }

    try {
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
        tokenType: newToken.tokenType,
        expiresIn: newToken.expiresIn,
      });

      await db
        .update(metaAdsIntegration)
        .set({
          encryptedCredentials: newEncrypted,
          tokenExpiresAt: newExpiresAt,
        })
        .where(eq(metaAdsIntegration.id, integration.id));

      refreshed++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : 'Unknown error';
      errors.push({ organizationId: integration.organizationId, message });

      // If the token is permanently invalid, mark integration for reconnection.
      // This is an expected condition (user revoked access, password changed,
      // etc.) — don't escalate to Sentry.
      if (isMetaAuthError(error)) {
        await markMetaAdsNeedsReconnect(db, integration.organizationId);
        continue;
      }

      logError('integrations.refreshMetaTokens', error, {
        feature: 'integrations',
        extra: { organizationId: integration.organizationId },
      });
    }
  }

  return ok({ refreshed, failed, skipped, errors });
};

export const refreshMetaTokens = (
  db: DbConnection,
  input: RefreshMetaTokensInput = { daysBeforeExpiry: 7 }
) =>
  trackedResult(
    'integrations.refreshMetaTokens',
    () => refreshMetaTokensImpl(db, input),
    {
      properties: { daysBeforeExpiry: input.daysBeforeExpiry },
      trackSuccess: false,
      trackFailure: false,
    }
  );

export type RefreshMetaTokensServiceResult = Awaited<
  ReturnType<typeof refreshMetaTokens>
>;
