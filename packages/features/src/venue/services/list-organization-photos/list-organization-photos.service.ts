import {
  type OrganizationPhoto,
  organizationPhoto,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, asc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListOrganizationPhotosInput,
  listOrganizationPhotosSchema,
} from './list-organization-photos.schema.js';

const listOrganizationPhotosImpl = async (
  db: DbConnection,
  input: ListOrganizationPhotosInput
): Promise<Result<{ items: OrganizationPhoto[] }>> => {
  const parsed = listOrganizationPhotosSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const items = await db.query.organizationPhoto.findMany({
    where: and(
      eq(organizationPhoto.organizationId, parsed.data.organizationId),
      eq(organizationPhoto.locationId, parsed.data.locationId)
    ),
    orderBy: [asc(organizationPhoto.sortOrder)],
  });

  return ok({ items });
};

export const listOrganizationPhotos = (
  db: DbConnection,
  input: ListOrganizationPhotosInput
) =>
  trackedResult(
    'venue.listOrganizationPhotos',
    () => withOrgScope((tx) => listOrganizationPhotosImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        locationId: input.locationId,
      },
    }
  );

export type ListOrganizationPhotosResult = Awaited<
  ReturnType<typeof listOrganizationPhotos>
>;
