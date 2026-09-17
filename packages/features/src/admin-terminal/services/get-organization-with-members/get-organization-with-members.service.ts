import { member, organization, user } from '@borradh-workspace/database';
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
  type GetOrganizationWithMembersInput,
  getOrganizationWithMembersSchema,
} from './get-organization-with-members.schema.js';

interface OrganizationMember {
  id: string;
  userId: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string | null;
  };
}

interface OrganizationWithMembers {
  id: string;
  name: string;
  slug: string;
  businessType: string;
  logo: string | null;
  createdAt: Date;
  members: OrganizationMember[];
}

const getOrganizationWithMembersImpl = async (
  db: DbConnection,
  input: GetOrganizationWithMembersInput
): Promise<Result<OrganizationWithMembers>> => {
  const parsed = getOrganizationWithMembersSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const org = await db.query.organization.findFirst({
    where: eq(organization.id, parsed.data.organizationId),
  });

  if (!org) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }

  const members = await db
    .select({
      id: member.id,
      userId: member.userId,
      role: member.role,
      createdAt: member.createdAt,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
      userRole: user.role,
      userId2: user.id,
    })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, parsed.data.organizationId));

  return ok({
    id: org.id,
    name: org.name,
    slug: org.slug,
    businessType: org.businessType,
    logo: org.logo,
    createdAt: org.createdAt,
    members: members.map((m) => ({
      id: m.id,
      userId: m.userId,
      role: m.role,
      createdAt: m.createdAt,
      user: {
        id: m.userId2,
        name: m.userName,
        email: m.userEmail,
        image: m.userImage,
        role: m.userRole,
      },
    })),
  });
};

export const getOrganizationWithMembers = (
  db: DbConnection,
  input: GetOrganizationWithMembersInput
) =>
  trackedResult(
    'adminTerminal.getOrganizationWithMembers',
    () => getOrganizationWithMembersImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type GetOrganizationWithMembersResult = Awaited<
  ReturnType<typeof getOrganizationWithMembers>
>;
