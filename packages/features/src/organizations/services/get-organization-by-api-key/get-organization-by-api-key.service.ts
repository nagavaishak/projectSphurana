import { organization } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type GetOrganizationByApiKeyInput,
  getOrganizationByApiKeySchema,
} from './get-organization-by-api-key.schema.js';

/**
 * Organization response type for API key lookup
 */
export interface OrganizationByApiKeyResponse {
  id: string;
  name: string;
  slug: string;
}

/**
 * Internal implementation of get organization by API key
 */
const getOrganizationByApiKeyImpl = async (
  db: DbConnection,
  input: GetOrganizationByApiKeyInput
): Promise<Result<OrganizationByApiKeyResponse>> => {
  // Validate input
  const parsed = getOrganizationByApiKeySchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { apiKey } = parsed.data;

  // Find organization by API key
  const result = await db.query.organization.findFirst({
    where: and(eq(organization.apiKey, apiKey), notDeleted(organization)),
    columns: {
      id: true,
      name: true,
      slug: true,
    },
  });

  if (!result) {
    return err(new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid API key'));
  }

  return ok(result);
};

/**
 * Get an organization by API key
 *
 * @param db - Database connection
 * @param input - API key input
 * @returns Result with organization or error
 *
 * @example
 * ```ts
 * const result = await getOrganizationByApiKey(db, { apiKey: 'sk_live_xxx' });
 *
 * if (result.success) {
 *   console.log('Organization:', result.data);
 * } else {
 *   console.error('Invalid API key');
 * }
 * ```
 */
export const getOrganizationByApiKey = (
  db: DbConnection,
  input: GetOrganizationByApiKeyInput
) =>
  trackedResult(
    'organizations.getOrganizationByApiKey',
    () => getOrganizationByApiKeyImpl(db, input),
    {
      properties: { hasApiKey: !!input.apiKey },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getOrganizationByApiKey
 */
export type GetOrganizationByApiKeyResult = Awaited<
  ReturnType<typeof getOrganizationByApiKey>
>;
