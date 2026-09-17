import {
  type OrganizationService,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListServicesForOrgInput,
  listServicesForOrgSchema,
} from './list-services-for-org.schema.js';

/**
 * Return every OrganizationService row for an org, sorted by sortOrder then
 * name. Unlike `listServices` this skips pagination so callers (e.g. the
 * recommendation engine) get the full list in one shot.
 */
const listServicesForOrgImpl = async (
  db: DbConnection,
  input: ListServicesForOrgInput
): Promise<Result<OrganizationService[]>> => {
  const parsed = listServicesForOrgSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const items = await db.query.organizationService.findMany({
    where: eq(organizationService.organizationId, parsed.data.organizationId),
    orderBy: [
      asc(organizationService.sortOrder),
      asc(organizationService.name),
    ],
  });

  return ok(items);
};

export const listServicesForOrg = (
  db: DbConnection,
  input: ListServicesForOrgInput
) =>
  trackedResult(
    'organizationServices.listServicesForOrg',
    () => withOrgScope((tx) => listServicesForOrgImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ListServicesForOrgResult = Awaited<
  ReturnType<typeof listServicesForOrg>
>;
