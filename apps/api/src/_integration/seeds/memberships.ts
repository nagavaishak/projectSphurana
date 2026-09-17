/**
 * Membership-domain seed helpers.
 *
 * Kept out of the shared harness (which owns the generic org/user/member
 * primitives) so the memberships spec can insert its own rows without touching
 * harness.ts. Shared primitives (seedLead, etc.) are imported from the harness.
 */
import { randomUUID } from 'node:crypto';
import {
  type LeadMembership,
  db,
  leadMembership,
  membershipPlan,
} from '@borradh-workspace/database';
import { seedLead } from '../harness.js';

/**
 * Insert a real `membership_plan` row scoped to an org. Returns its id.
 *
 * `organizationId`, `name`, and `priceCents` are the NOT-NULL columns without
 * a DB default; the rest (pricingType='one_time', validFor='1m',
 * currency='eur', isActive=true) fall back to the table defaults unless
 * overridden. `name` defaults unique-per-call so the
 * `membership_plan_org_name_unique` constraint never trips across seeds.
 */
export async function seedMembershipPlan(input: {
  organizationId: string;
  name?: string;
  priceCents?: number;
  currency?: string;
  pricingType?: (typeof membershipPlan.$inferInsert)['pricingType'];
  validFor?: (typeof membershipPlan.$inferInsert)['validFor'];
  sessionCount?: number | null;
  isActive?: boolean;
}): Promise<string> {
  const [row] = await db
    .insert(membershipPlan)
    .values({
      organizationId: input.organizationId,
      name: input.name ?? `Plan ${randomUUID()}`,
      priceCents: input.priceCents ?? 5000,
      currency: input.currency ?? 'eur',
      pricingType: input.pricingType ?? 'one_time',
      validFor: input.validFor ?? '1m',
      sessionCount: input.sessionCount ?? null,
      isActive: input.isActive ?? true,
    })
    .returning();
  return row.id;
}

/**
 * Insert a real `lead_membership` row scoped to an org. Returns its id.
 *
 * `organizationId`, `leadId`, and `planId` are NOT NULL FKs; a lead is seeded
 * automatically unless one is provided. `status` defaults to 'active'.
 */
export async function seedLeadMembership(input: {
  organizationId: string;
  planId: string;
  leadId?: string;
  status?: LeadMembership['status'];
  validUntil?: Date | null;
  sessionsRemaining?: number | null;
}): Promise<string> {
  const leadId =
    input.leadId ?? (await seedLead({ organizationId: input.organizationId }));
  const [row] = await db
    .insert(leadMembership)
    .values({
      organizationId: input.organizationId,
      leadId,
      planId: input.planId,
      status: input.status ?? 'active',
      validUntil: input.validUntil ?? null,
      sessionsRemaining: input.sessionsRemaining ?? null,
    })
    .returning();
  return row.id;
}
