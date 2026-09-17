import {
  type OrganizationPhoto,
  organizationPhoto,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
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
  type ReorderOrganizationPhotosInput,
  reorderOrganizationPhotosSchema,
} from './reorder-organization-photos.schema.js';

const reorderOrganizationPhotosImpl = async (
  db: DbConnection,
  input: ReorderOrganizationPhotosInput
): Promise<Result<{ items: OrganizationPhoto[] }>> => {
  const parsed = reorderOrganizationPhotosSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, locationId, orderedIds } = parsed.data;

  try {
    // Persist the new order: each id's sortOrder becomes its index. Every write
    // is scoped by org AND location so a foreign id in the list is a silent
    // no-op rather than a cross-org / cross-venue mutation.
    await Promise.all(
      orderedIds.map((id, index) =>
        db
          .update(organizationPhoto)
          .set({ sortOrder: index })
          .where(
            and(
              eq(organizationPhoto.id, id),
              eq(organizationPhoto.organizationId, organizationId),
              eq(organizationPhoto.locationId, locationId)
            )
          )
      )
    );

    const items = await db.query.organizationPhoto.findMany({
      where: and(
        eq(organizationPhoto.organizationId, organizationId),
        eq(organizationPhoto.locationId, locationId)
      ),
      orderBy: [asc(organizationPhoto.sortOrder)],
    });

    return ok({ items });
  } catch (error) {
    logError('venue.reorderOrganizationPhotos', error, {
      feature: 'venue',
      extra: { organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to reorder photos')
    );
  }
};

export const reorderOrganizationPhotos = (
  db: DbConnection,
  input: ReorderOrganizationPhotosInput
) =>
  trackedResult(
    'venue.reorderOrganizationPhotos',
    () =>
      withOrgScope((tx) => reorderOrganizationPhotosImpl(tx, input), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        locationId: input.locationId,
      },
    }
  );

export type ReorderOrganizationPhotosResult = Awaited<
  ReturnType<typeof reorderOrganizationPhotos>
>;
