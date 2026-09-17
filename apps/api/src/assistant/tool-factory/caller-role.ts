import { and, db, eq, member } from '@borradh-workspace/database';
import { logError } from '@borradh-workspace/observability';

/**
 * Resolve a caller's org role from the `member` table.
 *
 * Deliberately the SAME query `RoleGuard` runs
 * (`common/guards/role.guard.ts`), including its `role || 'member'` default,
 * so the HTTP path and the tool path cannot disagree about who someone is.
 * Two independent role lookups would be a correlated-error factory of exactly
 * the kind this codebase keeps producing.
 *
 * Returns `undefined` when the user is not a member of the organization. That
 * is NOT "no restriction" — a tool with a declared policy refuses on
 * `undefined`, matching `RoleGuard`, which throws `Not a member of this
 * organization` in the same case.
 */
export async function resolveCallerRole(input: {
  userId: string;
  organizationId: string;
}): Promise<'member' | 'admin' | 'owner' | undefined> {
  try {
    const memberRecord = await db.query.member.findFirst({
      where: and(
        eq(member.userId, input.userId),
        eq(member.organizationId, input.organizationId)
      ),
    });
    if (!memberRecord) return undefined;
    return (memberRecord.role || 'member') as 'member' | 'admin' | 'owner';
  } catch (error) {
    // A failed lookup must not read as "no role required". Log and return
    // undefined, which the factory treats as a refusal.
    logError('assistant.resolveCallerRole', error, {
      feature: 'assistant',
      extra: { userId: input.userId, organizationId: input.organizationId },
    });
    return undefined;
  }
}
