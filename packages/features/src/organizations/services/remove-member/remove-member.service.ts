import { member, session, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  internalError,
  ok,
} from '../../../shared/index.js';
import {
  type RemoveMemberInput,
  removeMemberSchema,
} from './remove-member.schema.js';

/**
 * Remove member response type
 */
export interface RemoveMemberResponse {
  success: boolean;
  removedUserId: string;
  organizationId: string;
}

/**
 * Optional Redis client type for clearing secondary session storage.
 */
interface RedisLike {
  del: (...keys: string[]) => Promise<number>;
}

/**
 * Internal implementation of remove member
 */
const removeMemberImpl = async (
  db: DbConnection,
  input: RemoveMemberInput,
  redis?: RedisLike | null
): Promise<Result<RemoveMemberResponse>> => {
  // Validate input
  const parsed = removeMemberSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, userId, requesterId } = parsed.data;

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

  // Check if requester is a member with permission
  const requesterMember = await db.query.member.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.organizationId, organizationId), eq(m.userId, requesterId)),
  });

  if (!requesterMember) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'You are not a member of this organization',
        {
          organizationId,
          userId: requesterId,
        }
      )
    );
  }

  // Get the member to be removed
  const targetMember = await db.query.member.findFirst({
    where: (m, { and, eq }) =>
      and(eq(m.organizationId, organizationId), eq(m.userId, userId)),
  });

  if (!targetMember) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        'User is not a member of this organization',
        {
          organizationId,
          userId,
        }
      )
    );
  }

  // Permission checks
  // User can remove themselves (leave organization)
  if (userId !== requesterId) {
    // Only owners and admins can remove others
    if (requesterMember.role !== 'owner' && requesterMember.role !== 'admin') {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'Only owners and admins can remove members',
          {
            organizationId,
            requesterRole: requesterMember.role,
          }
        )
      );
    }

    // Admins cannot remove owners
    if (targetMember.role === 'owner' && requesterMember.role !== 'owner') {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'Only owners can remove other owners',
          {
            organizationId,
            targetRole: targetMember.role,
          }
        )
      );
    }
  }

  // Cannot remove the last owner
  if (targetMember.role === 'owner') {
    const ownerCount = await db.query.member.findMany({
      where: (m, { and, eq }) =>
        and(eq(m.organizationId, organizationId), eq(m.role, 'owner')),
    });

    if (ownerCount.length === 1) {
      return err(
        new FeatureError(
          ErrorCodes.FORBIDDEN,
          'Cannot remove the last owner of the organization',
          {
            organizationId,
          }
        )
      );
    }
  }

  try {
    // Remove member
    await db
      .delete(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, userId)
        )
      );

    // Clear activeOrganizationId from the removed user's sessions
    // so they can't continue accessing the org
    try {
      const affectedSessions = await db
        .select({ token: session.token })
        .from(session)
        .where(
          and(
            eq(session.userId, userId),
            eq(session.activeOrganizationId, organizationId)
          )
        );

      await db
        .update(session)
        .set({ activeOrganizationId: null })
        .where(
          and(
            eq(session.userId, userId),
            eq(session.activeOrganizationId, organizationId)
          )
        );

      if (redis && affectedSessions.length > 0) {
        const redisKeys = affectedSessions.map((s) => s.token);
        await redis.del(...redisKeys).catch((error) =>
          logError('organizations.removeMember.redisCacheClear', error, {
            feature: 'organizations',
            extra: { organizationId, userId, keyCount: redisKeys.length },
          })
        );
      }
    } catch (sessionError) {
      // Log but don't fail the member removal
      logError('organizations.removeMember.sessionCleanup', sessionError, {
        feature: 'organizations',
        extra: { organizationId, userId },
      });
    }

    return ok({
      success: true,
      removedUserId: userId,
      organizationId,
    });
  } catch (error) {
    logError('organizations.removeMember', error, {
      feature: 'organizations',
      extra: { organizationId, userId },
    });
    return internalError(
      'An error occurred while removing the member. Please try again.',
      error
    );
  }
};

/**
 * Remove a member from an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Remove member data
 * @returns Result with success status or error
 *
 * @example
 * ```ts
 * const result = await removeMember(db, {
 *   organizationId: 'org-123',
 *   userId: 'user-456',
 *   requesterId: 'user-789',
 * });
 *
 * if (result.success) {
 *   console.log('Member removed');
 * }
 * ```
 */
export const removeMember = (
  db: DbConnection,
  input: RemoveMemberInput,
  redis?: RedisLike | null
) =>
  trackedResult(
    'organizations.removeMember',
    () => withOrgScope((tx) => removeMemberImpl(tx, input, redis), { db }),
    {
      properties: {
        organizationId: input.organizationId,
        userId: input.userId,
      },
    }
  );

/**
 * Result type for removeMember
 */
export type RemoveMemberResult = Awaited<ReturnType<typeof removeMember>>;
