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
  type CheckAdminAccessInput,
  checkAdminAccessSchema,
} from './check-admin-access.schema.js';

/**
 * Result of admin access check
 */
export interface AdminAccessResult {
  hasAccess: boolean;
  role: string | null;
}

/**
 * Internal implementation of check admin access
 */
const checkAdminAccessImpl = async (
  db: DbConnection,
  input: CheckAdminAccessInput
): Promise<Result<AdminAccessResult>> => {
  // Validate input
  const parsed = checkAdminAccessSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { userId, organizationId } = parsed.data;

  // Get user's membership in the organization
  const [membership] = await db
    .select({ role: member.role })
    .from(member)
    .where(
      and(eq(member.userId, userId), eq(member.organizationId, organizationId))
    )
    .limit(1);

  if (!membership) {
    return ok({
      hasAccess: false,
      role: null,
    });
  }

  // Check if user has admin or owner role
  const allowedRoles = ['owner', 'admin'];
  const hasAccess = allowedRoles.includes(membership.role);

  return ok({
    hasAccess,
    role: membership.role,
  });
};

/**
 * Check if a user has admin access in an organization
 *
 * @param db - Database connection
 * @param input - User ID and organization ID
 * @returns Result with hasAccess boolean and role
 */
export const checkAdminAccess = (
  db: DbConnection,
  input: CheckAdminAccessInput
) =>
  trackedResult(
    'organizations.checkAdminAccess',
    () => checkAdminAccessImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    }
  );

/**
 * Result type for checkAdminAccess
 */
export type CheckAdminAccessResult = Awaited<
  ReturnType<typeof checkAdminAccess>
>;
