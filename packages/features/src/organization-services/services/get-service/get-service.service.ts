import {
  type organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  applyServiceLocationOverride,
  err,
  loadServiceLocationOverrides,
  ok,
} from '../../../shared/index.js';
import {
  type GetServiceInput,
  getServiceSchema,
} from './get-service.schema.js';

export type ServiceWithRelations = typeof organizationService.$inferSelect;

/**
 * Internal implementation of get service
 */
const getServiceImpl = async (
  db: DbConnection,
  input: GetServiceInput
): Promise<Result<ServiceWithRelations>> => {
  // Validate input
  const parsed = getServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const service = await db.query.organizationService.findFirst({
    where: (svc, { eq, and }) =>
      and(
        eq(svc.id, parsed.data.id),
        eq(svc.organizationId, parsed.data.organizationId)
      ),
  });

  if (!service) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found', {
        id: parsed.data.id,
      })
    );
  }

  // Per-branch price / duration, via the same helper the list and both public
  // surfaces use — see `loadServiceLocationOverrides` for why it is shared.
  const overrides = await loadServiceLocationOverrides(db, {
    serviceIds: [service.id],
    locationId: parsed.data.locationId,
  });

  return ok(applyServiceLocationOverride(service, overrides.get(service.id)));
};

/**
 * Get a single organization service by ID
 */
export const getService = (db: DbConnection, input: GetServiceInput) =>
  trackedResult(
    'organizationServices.getService',
    () => withOrgScope((tx) => getServiceImpl(tx, input), { db }),
    {
      properties: { id: input.id, organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetServiceResult = Awaited<ReturnType<typeof getService>>;
