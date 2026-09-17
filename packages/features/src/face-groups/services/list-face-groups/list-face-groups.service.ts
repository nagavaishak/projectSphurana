import { faceGroup, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListFaceGroupsInput,
  listFaceGroupsSchema,
} from './list-face-groups.schema.js';

export interface FaceGroupListItem {
  id: string;
  clientName: string | null;
  clientNotes: string | null;
  serviceId: string | null;
  serviceName: string | null;
  createdAt: Date;
}

export interface ListFaceGroupsResponse {
  items: FaceGroupListItem[];
  total: number;
  limit: number;
  offset: number;
}

const listFaceGroupsImpl = async (
  db: DbConnection,
  input: ListFaceGroupsInput
): Promise<Result<ListFaceGroupsResponse>> => {
  const parsed = listFaceGroupsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, serviceId, limit, offset } = parsed.data;

  // Build where conditions
  const conditions = [eq(faceGroup.organizationId, organizationId)];

  if (serviceId) {
    conditions.push(eq(faceGroup.serviceId, serviceId));
  }

  const whereClause = and(...conditions);

  return withOrgScope(
    async (tx) => {
      // Get face groups with service relation
      const items = await tx.query.faceGroup.findMany({
        where: whereClause,
        limit,
        offset,
        orderBy: [desc(faceGroup.createdAt)],
        with: {
          service: {
            columns: {
              name: true,
            },
          },
        },
      });

      // Get total count
      const allItems = await tx.query.faceGroup.findMany({
        where: whereClause,
        columns: { id: true },
      });
      const total = allItems.length;

      // Map to response shape
      const mappedItems: FaceGroupListItem[] = items.map((item) => ({
        id: item.id,
        clientName: item.clientName,
        clientNotes: item.clientNotes,
        serviceId: item.serviceId,
        serviceName: item.service?.name ?? null,
        createdAt: item.createdAt,
      }));

      return ok({
        items: mappedItems,
        total,
        limit,
        offset,
      });
    },
    { db }
  );
};

/**
 * List face groups for an organization, optionally filtered by service.
 * By default, excluded face groups are hidden.
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - List input with filters
 * @returns Result with paginated face groups or error
 */
export const listFaceGroups = (db: DbConnection, input: ListFaceGroupsInput) =>
  trackedResult(
    'faceGroups.listFaceGroups',
    () => listFaceGroupsImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type ListFaceGroupsServiceResult = Awaited<
  ReturnType<typeof listFaceGroups>
>;
