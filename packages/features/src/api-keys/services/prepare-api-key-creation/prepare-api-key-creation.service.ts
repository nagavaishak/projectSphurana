import { trackedResult } from '@borradh-workspace/observability';
import { getSubscription } from '../../../billing/index.js';
import { getOrganization } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getPlanApiLimits } from '../../models/plan-limits.js';
import { listApiKeys } from '../list-api-keys/list-api-keys.service.js';
import {
  type PrepareApiKeyCreationInput,
  prepareApiKeyCreationSchema,
} from './prepare-api-key-creation.schema.js';

/**
 * Everything the better-auth `createApiKey` call needs that is derived from the
 * organization's state rather than from the request body.
 */
export interface PreparedApiKeyCreation {
  organizationName: string;
  organizationSlug: string;
  rateLimitMax: number;
}

const prepareApiKeyCreationImpl = async (
  db: DbConnection,
  input: PrepareApiKeyCreationInput
): Promise<Result<PreparedApiKeyCreation>> => {
  const parsed = prepareApiKeyCreationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Organization details are stamped into the key's metadata.
  const orgResult = await getOrganization(db, { id: organizationId });
  if (!orgResult.success) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  // Plan drives both API access and the per-key rate limit. An org with no
  // subscription row is treated as `free`.
  const subResult = await getSubscription(db, { organizationId });
  const planId = subResult.success ? subResult.data.planId : 'free';
  const limits = getPlanApiLimits(planId);

  if (!limits.hasApiAccess) {
    return err(
      new FeatureError(ErrorCodes.FORBIDDEN, 'API access requires a paid plan')
    );
  }

  // Quota check. A failed lookup deliberately does not block creation — the
  // plan's rate limit still bounds the key.
  const keysResult = await listApiKeys(db, { organizationId });
  if (keysResult.success && keysResult.data.items.length >= limits.maxApiKeys) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        `Maximum of ${limits.maxApiKeys} API keys allowed on your plan`
      )
    );
  }

  return ok({
    organizationName: orgResult.data.name,
    organizationSlug: orgResult.data.slug,
    rateLimitMax: limits.maxRequestsPerHour,
  });
};

/**
 * Resolve org metadata and enforce the plan's API-key policy before a key is
 * minted.
 */
export const prepareApiKeyCreation = (
  db: DbConnection,
  input: PrepareApiKeyCreationInput
) =>
  trackedResult(
    'apiKeys.prepareApiKeyCreation',
    () => prepareApiKeyCreationImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type PrepareApiKeyCreationResult = Awaited<
  ReturnType<typeof prepareApiKeyCreation>
>;
