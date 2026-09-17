import {
  onboardingSession,
  withSystemScope,
} from '@borradh-workspace/database';
import { and, eq } from 'drizzle-orm';
import type { DbConnection } from '../../../shared/index.js';

/**
 * True when the organization still has an ACTIVE onboarding session — i.e.
 * the user is mid-flow and hasn't reached billing yet. The whole onboarding
 * runs before any subscription (billing comes after), so callers like the
 * paid-plan interceptor treat an onboarding org as a free trial.
 *
 * Best-effort: never throws — a lookup failure returns false (fall back to the
 * normal paywall) so a DB blip can't silently open the gate.
 */
export const isOrgOnboarding = async (
  db: DbConnection,
  organizationId: string
): Promise<boolean> => {
  try {
    return await withSystemScope(
      async (tx) => {
        const row = await tx.query.onboardingSession.findFirst({
          where: and(
            eq(onboardingSession.organizationId, organizationId),
            eq(onboardingSession.status, 'active')
          ),
          columns: { id: true },
        });
        return Boolean(row);
      },
      { db }
    );
  } catch {
    return false;
  }
};
