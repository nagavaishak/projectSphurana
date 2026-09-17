import { member, organization } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { count, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { type DbConnection, type Result, ok } from '../../../shared/index.js';
import { ErrorCodes, FeatureError, err } from '../../../shared/index.js';
import {
  type ListAllOrganizationsInput,
  listAllOrganizationsSchema,
} from './list-all-organizations.schema.js';

const listAllOrganizationsImpl = async (
  db: DbConnection,
  input: ListAllOrganizationsInput
): Promise<
  Result<{
    items: Array<{
      id: string;
      name: string;
      slug: string;
      businessType: string;
      memberCount: number;
      createdAt: Date;
    }>;
    total: number;
    limit: number;
    offset: number;
  }>
> => {
  const parsed = listAllOrganizationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { search, limit, offset } = parsed.data;

  const searchCondition = search
    ? or(
        ilike(organization.name, `%${search}%`),
        ilike(organization.slug, `%${search}%`)
      )
    : undefined;

  // Get total count
  const [countResult] = await db
    .select({ total: count() })
    .from(organization)
    .where(searchCondition);

  // Get organizations with member count
  const items = await db
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      businessType: organization.businessType,
      memberCount: sql<number>`cast(count(${member.id}) as integer)`,
      createdAt: organization.createdAt,
    })
    .from(organization)
    .leftJoin(member, eq(organization.id, member.organizationId))
    .where(searchCondition)
    .groupBy(organization.id)
    .orderBy(desc(organization.createdAt))
    .limit(limit)
    .offset(offset);

  return ok({
    items,
    total: countResult?.total ?? 0,
    limit,
    offset,
  });
};

export const listAllOrganizations = (
  db: DbConnection,
  input: ListAllOrganizationsInput
) =>
  trackedResult(
    'adminTerminal.listAllOrganizations',
    () => listAllOrganizationsImpl(db, input),
    { properties: { search: input.search } }
  );

export type ListAllOrganizationsResult = Awaited<
  ReturnType<typeof listAllOrganizations>
>;
