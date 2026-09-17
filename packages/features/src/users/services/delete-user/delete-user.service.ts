import {
  member,
  organization,
  session,
  subscriptions,
  user,
} from '@borradh-workspace/database';
import { getStripeService } from '@borradh-workspace/integrations/stripe';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { fireNotionAccountDeleted } from '../../../shared/notion-crm.js';
import {
  type DeleteUserInput,
  deleteUserSchema,
} from './delete-user.schema.js';

/**
 * Optional Redis client type for clearing secondary session storage.
 */
interface RedisLike {
  del: (...keys: string[]) => Promise<number>;
}

/**
 * Internal implementation of delete user
 */
const deleteUserImpl = async (
  db: DbConnection,
  input: DeleteUserInput,
  redis?: RedisLike | null
): Promise<Result<{ id: string; deleted: true }>> => {
  // Validate input
  const parsed = deleteUserSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { id } = parsed.data;

  // Check if user exists
  const existing = await db.query.user.findFirst({
    where: (user, { eq }) => eq(user.id, id),
  });

  if (!existing) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, `User with ID ${id} not found`, {
        userId: id,
      })
    );
  }

  // Capture primary org name before deletion (for CRM update)
  const primaryMembership = await db.query.member.findFirst({
    where: (m, { eq: eq2 }) => eq2(m.userId, id),
    with: { organization: { columns: { name: true } } },
  });
  const primaryOrgName = (
    primaryMembership as { organization?: { name?: string } } | undefined
  )?.organization?.name;

  // Find organizations where this user is the sole member and delete them.
  // This must happen before deleting the user, since user deletion cascades
  // to member rows (which would orphan the organizations).
  const userOrgs = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, id));

  if (userOrgs.length > 0) {
    const orgIds = userOrgs.map((m) => m.organizationId);

    // Find which of these orgs have exactly 1 member (this user)
    const singleMemberOrgs = await db
      .select({
        organizationId: member.organizationId,
        memberCount: sql<number>`count(*)::int`.as('member_count'),
      })
      .from(member)
      .where(inArray(member.organizationId, orgIds))
      .groupBy(member.organizationId)
      .having(sql`count(*) = 1`);

    const orgsToDelete = singleMemberOrgs.map((r) => r.organizationId);

    // Cancel Stripe subscriptions and delete customers for orgs being deleted (best-effort)
    if (orgsToDelete.length > 0) {
      try {
        const stripe = getStripeService();

        // Cancel active subscriptions first
        const activeSubscriptions = await db
          .select({
            stripeSubscriptionId: subscriptions.stripeSubscriptionId,
            organizationId: subscriptions.organizationId,
          })
          .from(subscriptions)
          .where(inArray(subscriptions.organizationId, orgsToDelete));

        await Promise.allSettled(
          activeSubscriptions
            .filter(
              (s): s is typeof s & { stripeSubscriptionId: string } =>
                !!s.stripeSubscriptionId
            )
            .map((s) =>
              stripe.cancelSubscriptionImmediately(s.stripeSubscriptionId)
            )
        );

        // Then delete Stripe customers
        const orgsWithStripe = await db
          .select({ stripeCustomerId: organization.stripeCustomerId })
          .from(organization)
          .where(inArray(organization.id, orgsToDelete));

        await Promise.allSettled(
          orgsWithStripe
            .filter(
              (o): o is typeof o & { stripeCustomerId: string } =>
                !!o.stripeCustomerId
            )
            .map((o) => stripe.getClient().customers.del(o.stripeCustomerId))
        );
      } catch (stripeError) {
        logError('users.deleteUser.stripeCleanup', stripeError, {
          feature: 'users',
          extra: { userId: id, orgsToDelete },
        });
      }
    }

    // Delete organizations where user is the sole member
    // (cascade handles all dependent data: leads, posts, assets, etc.)
    if (orgsToDelete.length > 0) {
      await db
        .delete(organization)
        .where(inArray(organization.id, orgsToDelete));
    }
  }

  // Collect session tokens before cascade-deleting the user (needed for Redis cleanup)
  const userSessions = await db
    .select({ token: session.token })
    .from(session)
    .where(eq(session.userId, id));

  // Delete user (cascades to member, session, account, etc.)
  await db.delete(user).where(eq(user.id, id));

  if (redis) {
    const redisKeys = [
      ...userSessions.map((s) => s.token),
      `active-sessions-${id}`,
    ];
    try {
      await redis.del(...redisKeys);
    } catch (redisError) {
      // Best-effort: DB sessions are already gone
      logError('users.deleteUser.redis', redisError, {
        feature: 'users',
        extra: { userId: id, sessionCount: userSessions.length },
      });
    }
  }

  // Fire Notion CRM update (non-blocking)
  fireNotionAccountDeleted(existing.email, primaryOrgName);

  return ok({ id, deleted: true as const });
};

/**
 * Delete a user by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - User deletion input
 * @returns Result with deletion confirmation or error
 *
 * @example
 * ```ts
 * // Without transaction
 * const result = await deleteUser(db, { id: 'user-123' });
 *
 * // With transaction
 * await db.transaction(async (tx) => {
 *   const result = await deleteUser(tx, { id: 'user-123' });
 *   if (!result.success) throw new Error(result.error.message);
 *   // ... more operations with tx
 * });
 * ```
 */
export const deleteUser = (
  db: DbConnection,
  input: DeleteUserInput,
  redis?: RedisLike | null
) =>
  trackedResult('users.deleteUser', () => deleteUserImpl(db, input, redis), {
    properties: { userId: input.id },
  });

/**
 * Result type for deleteUser
 */
export type DeleteUserResult = Awaited<ReturnType<typeof deleteUser>>;
