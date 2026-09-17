import {
  instagramIntegration,
  metaAdsIntegration,
  whatsappAccount,
} from '@borradh-workspace/database';
import { isMetaAuthError } from '@borradh-workspace/integrations';
import { createLogger } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { type DbConnection, logAuditEvent } from '../../../shared/index.js';

const logger = createLogger('integrations.markNeedsReconnect');

type IntegrationEntityType =
  | 'meta_ads_integration'
  | 'instagram_integration'
  | 'whatsapp_account';

/**
 * Maps a conversation/messaging platform to the integration "type" used by
 * {@link handleMetaAuthError}. Facebook Messenger auth lives on the Meta Ads
 * integration (the page access token is a child of meta_ads_integration), so
 * it maps to 'meta_ads'.
 */
export function metaTypeForPlatform(
  platform: string
): 'meta_ads' | 'instagram' | 'whatsapp' {
  if (platform === 'instagram_dm') return 'instagram';
  if (platform === 'whatsapp') return 'whatsapp';
  return 'meta_ads';
}

/**
 * Records a token-status transition to the audit log. System-actor entry so
 * it's clear the change was driven by an API error / reconnect, not a user.
 * Never throws — a failed audit write must not break the calling operation.
 */
async function auditTokenStatusChange(
  db: DbConnection,
  input: {
    entityType: IntegrationEntityType;
    entityId: string;
    organizationId: string;
    before: string | null;
    after: 'valid' | 'needs_reconnect';
    reason: string;
  }
): Promise<void> {
  try {
    await logAuditEvent(db, {
      action: 'update',
      entityType: input.entityType,
      entityId: input.entityId,
      actorType: 'system',
      actorId: null,
      organizationId: input.organizationId,
      metadata: {
        field: 'tokenStatus',
        before: input.before,
        after: input.after,
        reason: input.reason,
      },
    });
  } catch (error) {
    logger.error('Failed to write token status audit log', {
      organizationId: input.organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Marks a Meta Ads integration as needing reconnection.
 * Called when a Meta API call fails with an auth error (code 190, etc.).
 */
export async function markMetaAdsNeedsReconnect(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const integration = await db.query.metaAdsIntegration.findFirst({
      where: eq(metaAdsIntegration.organizationId, organizationId),
      columns: { id: true, tokenStatus: true },
    });

    if (!integration || integration.tokenStatus === 'needs_reconnect') return;

    await db
      .update(metaAdsIntegration)
      .set({ tokenStatus: 'needs_reconnect' })
      .where(eq(metaAdsIntegration.id, integration.id));

    logger.warn('Meta Ads integration marked as needs_reconnect', {
      organizationId,
      integrationId: integration.id,
    });

    await auditTokenStatusChange(db, {
      entityType: 'meta_ads_integration',
      entityId: integration.id,
      organizationId,
      before: integration.tokenStatus,
      after: 'needs_reconnect',
      reason: 'meta_auth_error',
    });
  } catch (error) {
    // Don't let marking fail silently break the calling operation
    logger.error('Failed to mark Meta Ads integration as needs_reconnect', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Marks an Instagram integration as needing reconnection.
 * Called when an Instagram API call fails with an auth error.
 */
export async function markInstagramNeedsReconnect(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const integration = await db.query.instagramIntegration.findFirst({
      where: eq(instagramIntegration.organizationId, organizationId),
      columns: { id: true, tokenStatus: true },
    });

    if (!integration || integration.tokenStatus === 'needs_reconnect') return;

    await db
      .update(instagramIntegration)
      .set({ tokenStatus: 'needs_reconnect' })
      .where(eq(instagramIntegration.id, integration.id));

    logger.warn('Instagram integration marked as needs_reconnect', {
      organizationId,
      integrationId: integration.id,
    });

    await auditTokenStatusChange(db, {
      entityType: 'instagram_integration',
      entityId: integration.id,
      organizationId,
      before: integration.tokenStatus,
      after: 'needs_reconnect',
      reason: 'meta_auth_error',
    });
  } catch (error) {
    logger.error('Failed to mark Instagram integration as needs_reconnect', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Marks WhatsApp accounts in an organization as needing reconnection.
 * Marks ALL active accounts in the org because the auth error doesn't
 * carry a specific account ID — when one Meta token is revoked, others
 * tied to the same Meta Business are typically affected too.
 */
export async function markWhatsAppNeedsReconnect(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  try {
    const accounts = await db.query.whatsappAccount.findMany({
      where: eq(whatsappAccount.organizationId, organizationId),
      columns: { id: true, tokenStatus: true },
    });

    const stale = accounts.filter((a) => a.tokenStatus !== 'needs_reconnect');
    if (stale.length === 0) return;

    await db
      .update(whatsappAccount)
      .set({ tokenStatus: 'needs_reconnect' })
      .where(eq(whatsappAccount.organizationId, organizationId));

    logger.warn('WhatsApp account(s) marked as needs_reconnect', {
      organizationId,
      count: stale.length,
    });

    for (const account of stale) {
      await auditTokenStatusChange(db, {
        entityType: 'whatsapp_account',
        entityId: account.id,
        organizationId,
        before: account.tokenStatus,
        after: 'needs_reconnect',
        reason: 'meta_auth_error',
      });
    }
  } catch (error) {
    logger.error('Failed to mark WhatsApp account as needs_reconnect', {
      organizationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Convenience function: if an error is a Meta auth error, mark the
 * appropriate integration as needs_reconnect. Safe to call in any
 * catch block — it's a no-op if the error isn't an auth error.
 */
export async function handleMetaAuthError(
  db: DbConnection,
  error: unknown,
  context: {
    type: 'meta_ads' | 'instagram' | 'whatsapp';
    organizationId: string;
  }
): Promise<void> {
  if (!isMetaAuthError(error)) return;

  if (context.type === 'meta_ads') {
    await markMetaAdsNeedsReconnect(db, context.organizationId);
  } else if (context.type === 'instagram') {
    await markInstagramNeedsReconnect(db, context.organizationId);
  } else {
    await markWhatsAppNeedsReconnect(db, context.organizationId);
  }
}

/**
 * Resets token status to 'valid' after a successful reconnection.
 * Called during the OAuth connect flow.
 */
export async function resetMetaAdsTokenStatus(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  const integration = await db.query.metaAdsIntegration.findFirst({
    where: eq(metaAdsIntegration.organizationId, organizationId),
    columns: { id: true, tokenStatus: true },
  });
  if (!integration) return;

  await db
    .update(metaAdsIntegration)
    .set({ tokenStatus: 'valid' })
    .where(eq(metaAdsIntegration.id, integration.id));

  if (integration.tokenStatus !== 'valid') {
    await auditTokenStatusChange(db, {
      entityType: 'meta_ads_integration',
      entityId: integration.id,
      organizationId,
      before: integration.tokenStatus,
      after: 'valid',
      reason: 'reconnect',
    });
  }
}

export async function resetInstagramTokenStatus(
  db: DbConnection,
  organizationId: string
): Promise<void> {
  const integration = await db.query.instagramIntegration.findFirst({
    where: eq(instagramIntegration.organizationId, organizationId),
    columns: { id: true, tokenStatus: true },
  });
  if (!integration) return;

  await db
    .update(instagramIntegration)
    .set({ tokenStatus: 'valid' })
    .where(eq(instagramIntegration.id, integration.id));

  if (integration.tokenStatus !== 'valid') {
    await auditTokenStatusChange(db, {
      entityType: 'instagram_integration',
      entityId: integration.id,
      organizationId,
      before: integration.tokenStatus,
      after: 'valid',
      reason: 'reconnect',
    });
  }
}

/**
 * Resets WhatsApp account token status to 'valid' after a successful
 * reconnection. Pass an account ID to scope to a single row, or omit
 * to reset all accounts in the org (used by the org-wide reconnect path).
 */
export async function resetWhatsAppTokenStatus(
  db: DbConnection,
  organizationId: string,
  accountId?: string
): Promise<void> {
  const accounts = await db.query.whatsappAccount.findMany({
    where: accountId
      ? eq(whatsappAccount.id, accountId)
      : eq(whatsappAccount.organizationId, organizationId),
    columns: { id: true, tokenStatus: true },
  });
  if (accounts.length === 0) return;

  await db
    .update(whatsappAccount)
    .set({ tokenStatus: 'valid' })
    .where(
      accountId
        ? eq(whatsappAccount.id, accountId)
        : eq(whatsappAccount.organizationId, organizationId)
    );

  for (const account of accounts) {
    if (account.tokenStatus !== 'valid') {
      await auditTokenStatusChange(db, {
        entityType: 'whatsapp_account',
        entityId: account.id,
        organizationId,
        before: account.tokenStatus,
        after: 'valid',
        reason: 'reconnect',
      });
    }
  }
}
