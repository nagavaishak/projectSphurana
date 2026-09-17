import {
  practitioner,
  practitionerLocation,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq, ilike, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  atLocationOrUnassigned,
  err,
  notDeleted,
  ok,
  staffBookablePractitioner,
} from '../../../shared/index.js';
import {
  type ListPractitionersInput,
  listPractitionersSchema,
} from './list-practitioners.schema.js';

const listPractitionersImpl = async (
  db: DbConnection,
  input: ListPractitionersInput
): Promise<
  Result<{ items: typeof results; limit: number; offset: number }>
> => {
  const parsed = listPractitionersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    isActive,
    bookable,
    locationId,
    search,
    limit,
    offset,
  } = parsed.data;

  const conditions: SQL[] = [
    eq(practitioner.organizationId, organizationId),
    notDeleted(practitioner),
  ];

  if (isActive !== undefined) {
    conditions.push(eq(practitioner.isActive, isActive));
  }

  // The one predicate for "staff may book this person", shared with every
  // other booking path rather than re-typed here (ENG-794).
  if (bookable) {
    conditions.push(staffBookablePractitioner() as SQL);
  }

  if (locationId) {
    conditions.push(
      atLocationOrUnassigned(
        db,
        practitionerLocation,
        practitionerLocation.practitionerId,
        practitioner.id,
        practitionerLocation.locationId,
        locationId
      )
    );
  }

  if (search) {
    conditions.push(
      or(
        ilike(practitioner.name, `%${search}%`),
        ilike(practitioner.email, `%${search}%`)
      ) as SQL
    );
  }

  const results = await db.query.practitioner.findMany({
    where: and(...conditions),
    with: {
      locations: {
        with: { location: true },
      },
      services: {
        with: { service: true },
      },
    },
    orderBy: [desc(practitioner.createdAt)],
    limit,
    offset,
  });

  return ok({ items: results, limit, offset });
};

export const listPractitioners = (
  db: DbConnection,
  input: ListPractitionersInput
) =>
  trackedResult(
    'practitioners.listPractitioners',
    () => withOrgScope((tx) => listPractitionersImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListPractitionersResult = Awaited<
  ReturnType<typeof listPractitioners>
>;
