import { apikey } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { sql } from 'drizzle-orm';
import type { ApiKeyMetadata } from '../../../auth/services/create-api-key/create-api-key.types.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListApiKeysInput,
  listApiKeysSchema,
} from './list-api-keys.schema.js';

export interface ApiKeyListItem {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  enabled: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  lastRequest: Date | null;
  scopes: string[];
  rateLimitMax: number | null;
}

const listApiKeysImpl = async (db: DbConnection, input: ListApiKeysInput) => {
  const parsed = listApiKeysSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const rows = await db
    .select({
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
    })
    .from(apikey)
    .where(
      sql`${apikey.metadata}->>'organizationId' = ${parsed.data.organizationId}`
    )
    .orderBy(sql`${apikey.createdAt} DESC`);

  const items: ApiKeyListItem[] = rows.map((row) => {
    const metadata = row.metadata as ApiKeyMetadata | null;
    return {
      id: row.id,
      name: row.name,
      start: row.start,
      prefix: row.prefix,
      enabled: row.enabled,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      lastRequest: row.lastRequest,
      scopes: metadata?.scopes ?? [],
      rateLimitMax: row.rateLimitMax,
    };
  });

  return ok({ items });
};

export const listApiKeys = (db: DbConnection, input: ListApiKeysInput) =>
  trackedResult('apiKeys.listApiKeys', () => listApiKeysImpl(db, input), {
    properties: { organizationId: input.organizationId },
  });

export type ListApiKeysResult = Awaited<ReturnType<typeof listApiKeys>>;
