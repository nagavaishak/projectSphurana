import { apikey } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import type { ApiKeyMetadata } from '../../../auth/services/create-api-key/create-api-key.types.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateApiKeyInput,
  updateApiKeySchema,
} from './update-api-key.schema.js';

const updateApiKeyImpl = async (db: DbConnection, input: UpdateApiKeyInput) => {
  const parsed = updateApiKeySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { keyId, organizationId, name, enabled } = parsed.data;

  // Verify the key belongs to the organization
  const existing = await db
    .select({ id: apikey.id })
    .from(apikey)
    .where(
      and(
        eq(apikey.id, keyId),
        sql`${apikey.metadata}->>'organizationId' = ${organizationId}`
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'API key not found'));
  }

  // Build update payload with only provided fields
  const updates: Partial<typeof apikey.$inferInsert> = {};
  if (name !== undefined) updates.name = name;
  if (enabled !== undefined) updates.enabled = enabled;

  if (Object.keys(updates).length === 0) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'No fields to update')
    );
  }

  const [updated] = await db
    .update(apikey)
    .set(updates)
    .where(eq(apikey.id, keyId))
    .returning({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      prefix: apikey.prefix,
      enabled: apikey.enabled,
      expiresAt: apikey.expiresAt,
      createdAt: apikey.createdAt,
      lastRequest: apikey.lastRequest,
      metadata: apikey.metadata,
      rateLimitMax: apikey.rateLimitMax,
    });

  const metadata = updated.metadata as ApiKeyMetadata | null;

  return ok({
    id: updated.id,
    name: updated.name,
    start: updated.start,
    prefix: updated.prefix,
    enabled: updated.enabled,
    expiresAt: updated.expiresAt,
    createdAt: updated.createdAt,
    lastRequest: updated.lastRequest,
    scopes: metadata?.scopes ?? [],
    rateLimitMax: updated.rateLimitMax,
  });
};

export const updateApiKey = (db: DbConnection, input: UpdateApiKeyInput) =>
  trackedResult('apiKeys.updateApiKey', () => updateApiKeyImpl(db, input), {
    properties: { keyId: input.keyId, organizationId: input.organizationId },
  });

export type UpdateApiKeyResult = Awaited<ReturnType<typeof updateApiKey>>;
