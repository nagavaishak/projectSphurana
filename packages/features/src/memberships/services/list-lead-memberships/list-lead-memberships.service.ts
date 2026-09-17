import { leadMembership, withOrgScope } from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type { LeadMembershipWithPlan } from '../../models/index.js';
import {
  type ListLeadMembershipsInput,
  listLeadMembershipsSchema,
} from './list-lead-memberships.schema.js';

/**
 * List lead memberships for the org (newest first), optionally filtered by
 * lead and/or status, each joined with its plan.
 */
const listLeadMembershipsImpl = async (
  db: DbConnection,
  input: ListLeadMembershipsInput
): Promise<Result<LeadMembershipWithPlan[]>> => {
  const parsed = listLeadMembershipsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, leadId, status } = parsed.data;

  try {
    const conditions: SQL[] = [
      eq(leadMembership.organizationId, organizationId),
    ];
    if (leadId !== undefined) {
      conditions.push(eq(leadMembership.leadId, leadId));
    }
    if (status !== undefined) {
      conditions.push(eq(leadMembership.status, status));
    }

    const memberships = await db.query.leadMembership.findMany({
      where: and(...conditions),
      orderBy: [desc(leadMembership.createdAt)],
      with: { plan: true },
    });

    // Effective status: a membership past its `validUntil` is expired even if
    // the stored status still reads `active`/`past_due` (nothing sweeps stale
    // one-time rows). Cancelled/already-expired rows are left untouched.
    const now = new Date();
    const effective = (memberships as LeadMembershipWithPlan[]).map((m) =>
      m.validUntil &&
      new Date(m.validUntil) < now &&
      m.status !== 'cancelled' &&
      m.status !== 'expired'
        ? { ...m, status: 'expired' as const }
        : m
    );

    return ok(effective);
  } catch (error) {
    logError('memberships.listLeadMemberships', error, {
      feature: 'memberships',
      extra: { organizationId, leadId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to list memberships')
    );
  }
};

export const listLeadMemberships = (
  db: DbConnection,
  input: ListLeadMembershipsInput
) =>
  trackedResult(
    'memberships.listLeadMemberships',
    () => withOrgScope((tx) => listLeadMembershipsImpl(tx, input), { db }),
    {
      properties: { organizationId: input.organizationId },
    }
  );

export type ListLeadMembershipsResult = Awaited<
  ReturnType<typeof listLeadMemberships>
>;
