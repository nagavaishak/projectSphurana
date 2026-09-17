import { member } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type CheckMemberAccessInput,
  checkMemberAccessSchema,
} from './check-member-access.schema.js';

export interface MemberAccessResult {
  isMember: boolean;
  role: string | null;
}

const checkMemberAccessImpl = async (
  db: DbConnection,
  input: CheckMemberAccessInput
): Promise<Result<MemberAccessResult>> => {
  const parsed = checkMemberAccessSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, organizationId } = parsed.data;

  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId))
    )
    .limit(1);

  if (!membership) {
    return ok({ isMember: false, role: null });
  }

  return ok({ isMember: true, role: membership.role });
};

export const checkMemberAccess = (
  db: DbConnection,
  input: CheckMemberAccessInput
) =>
  trackedResult(
    'organizations.checkMemberAccess',
    () => checkMemberAccessImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    }
  );

export type CheckMemberAccessResult = Awaited<
  ReturnType<typeof checkMemberAccess>
>;
