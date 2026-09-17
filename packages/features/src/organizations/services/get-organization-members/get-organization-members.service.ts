import { withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetOrganizationMembersInput,
  getOrganizationMembersSchema,
} from './get-organization-members.schema.js';

/**
 * Member with user info response type
 */
export interface OrganizationMemberResponse {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
  };
}

/**
 * Internal implementation of get organization members
 */
const getOrganizationMembersImpl = async (
  db: DbConnection,
  input: GetOrganizationMembersInput
): Promise<Result<OrganizationMemberResponse[]>> => {
  // Validate input
  const parsed = getOrganizationMembersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;

  // Check if organization exists
  const org = await db.query.organization.findFirst({
    where: (o, { and, eq, isNull }) =>
      and(eq(o.id, organizationId), isNull(o.deletedAt)),
  });

  if (!org) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Organization with ID ${organizationId} not found`,
        {
          organizationId,
        }
      )
    );
  }

  // Get members with user info
  const members = await db.query.member.findMany({
    where: (m, { eq }) => eq(m.organizationId, organizationId),
    with: {
      user: true,
    },
  });

  const response: OrganizationMemberResponse[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role,
    createdAt: m.createdAt,
    user: {
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      image: m.user.image,
    },
  }));

  return ok(response);
};

/**
 * Get all members of an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Organization ID input
 * @returns Result with array of members or error
 *
 * @example
 * ```ts
 * const result = await getOrganizationMembers(db, { organizationId: 'org-123' });
 *
 * if (result.success) {
 *   console.log('Members:', result.data);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const getOrganizationMembers = (
  db: DbConnection,
  input: GetOrganizationMembersInput
) =>
  trackedResult(
    'organizations.getOrganizationMembers',
    () => withOrgScope((tx) => getOrganizationMembersImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getOrganizationMembers
 */
export type GetOrganizationMembersResult = Awaited<
  ReturnType<typeof getOrganizationMembers>
>;
