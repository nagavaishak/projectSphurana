import { apikey } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type RevokeApiKeyInput,
  revokeApiKeySchema,
} from './revoke-api-key.schema.js';

const revokeApiKeyImpl = async (db: DbConnection, input: RevokeApiKeyInput) => {
  const parsed = revokeApiKeySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Verify the key belongs to the organization before deleting
  const existing = await db
    .select({ id: apikey.id })
    .from(apikey)
    .where(
      and(
        eq(apikey.id, parsed.data.keyId),
        sql`${apikey.metadata}->>'organizationId' = ${parsed.data.organizationId}`
      )
    )
    .limit(1);

  if (existing.length === 0) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'API key not found'));
  }

  await db.delete(apikey).where(eq(apikey.id, parsed.data.keyId));

  return ok({ success: true });
};

export const revokeApiKey = (db: DbConnection, input: RevokeApiKeyInput) =>
  trackedResult('apiKeys.revokeApiKey', () => revokeApiKeyImpl(db, input), {
    properties: { keyId: input.keyId, organizationId: input.organizationId },
  });

export type RevokeApiKeyResult = Awaited<ReturnType<typeof revokeApiKey>>;
