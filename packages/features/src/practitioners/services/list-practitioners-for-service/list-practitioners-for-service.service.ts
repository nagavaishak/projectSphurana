import { practitionerService, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListPractitionersForServiceInput,
  listPractitionersForServiceSchema,
} from './list-practitioners-for-service.schema.js';

const listPractitionersForServiceImpl = async (
  db: DbConnection,
  input: ListPractitionersForServiceInput
): Promise<Result<typeof results>> => {
  const parsed = listPractitionersForServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { serviceId, organizationId, activeOnly } = parsed.data;

  // Find all practitioner-service links for this service
  const links = await db.query.practitionerService.findMany({
    where: eq(practitionerService.serviceId, serviceId),
    with: {
      practitioner: {
        with: {
          locations: {
            with: { location: true },
          },
        },
      },
    },
  });

  // Filter to practitioners in this org (and optionally active only)
  const results = links
    .map((link) => link.practitioner)
    .filter((p) => p.organizationId === organizationId && !p.deletedAt)
    .filter((p) => !activeOnly || p.isActive);

  return ok(results);
};

export const listPractitionersForService = (
  db: DbConnection,
  input: ListPractitionersForServiceInput
) =>
  trackedResult(
    'practitioners.listPractitionersForService',
    () =>
      withOrgScope((tx) => listPractitionersForServiceImpl(tx, input), { db }),
    {
      properties: {
        serviceId: input.serviceId,
        organizationId: input.organizationId,
      },
    }
  );

export type ListPractitionersForServiceResult = Awaited<
  ReturnType<typeof listPractitionersForService>
>;
