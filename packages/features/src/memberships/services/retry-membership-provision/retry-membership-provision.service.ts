import {
  leadMembership,
  sale,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { purchaseMembership } from '../purchase-membership/purchase-membership.service.js';
import {
  type RetryMembershipProvisionInput,
  retryMembershipProvisionSchema,
} from './retry-membership-provision.schema.js';

export interface RetryMembershipProvisionResult {
  /** Membership lines that were successfully provisioned on this run. */
  provisioned: number;
  /** Membership lines that already had a lead_membership (nothing to do). */
  skipped: number;
  /** Membership lines that still failed to provision (logged for follow-up). */
  failed: number;
}

/**
 * Re-provision membership lines that a completed sale never turned into a
 * `lead_membership` row — the recovery path for the M2 gap where
 * `purchaseMembership` fails AFTER the sale is already completed and paid
 * (recurring plans hit Stripe, so a transient Stripe error strands the paid
 * membership).
 *
 * Idempotent and needs NO new table: a provisioned line is detectable by an
 * existing `lead_membership.saleItemId` back-reference, so this only re-runs
 * the lines that are still missing one. Safe to call repeatedly (e.g. wired to
 * a "retry provisioning" endpoint or a sweeper).
 */
const retryMembershipProvisionImpl = async (
  db: DbConnection,
  input: RetryMembershipProvisionInput
): Promise<Result<RetryMembershipProvisionResult>> => {
  const parsed = retryMembershipProvisionSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, saleId } = parsed.data;

  try {
    const existing = await withOrgScope(
      (tx) =>
        tx.query.sale.findFirst({
          where: and(
            eq(sale.id, saleId),
            eq(sale.organizationId, organizationId)
          ),
          with: { items: true },
        }),
      { db }
    );

    if (!existing) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Sale not found'));
    }
    if (existing.status !== 'completed') {
      return err(
        new FeatureError(
          ErrorCodes.INVALID_STATE,
          'Only a completed sale can have its memberships re-provisioned'
        )
      );
    }
    if (!existing.leadId) {
      // A lead-less sale can never own a membership — nothing to recover.
      return ok({ provisioned: 0, skipped: 0, failed: 0 });
    }
    const leadId = existing.leadId;

    const membershipItems = (
      existing as typeof existing & {
        items: {
          id: string;
          itemType: string;
          membershipPlanId: string | null;
        }[];
      }
    ).items.filter(
      (i) => i.itemType === 'membership' && i.membershipPlanId != null
    );

    let provisioned = 0;
    let skipped = 0;
    let failed = 0;

    for (const item of membershipItems) {
      // Already provisioned? A lead_membership with this saleItemId is the
      // provenance marker — skip it (this is what makes the retry idempotent).
      const already = await withOrgScope(
        (tx) =>
          tx.query.leadMembership.findFirst({
            where: and(
              eq(leadMembership.saleItemId, item.id),
              eq(leadMembership.organizationId, organizationId)
            ),
            columns: { id: true },
          }),
        { db }
      );
      if (already) {
        skipped++;
        continue;
      }

      const result = await purchaseMembership(db, {
        organizationId,
        leadId,
        planId: item.membershipPlanId as string,
        saleItemId: item.id,
      });
      if (result.success) {
        provisioned++;
      } else {
        failed++;
        logError(
          'memberships.retryMembershipProvision',
          new Error(result.error.message),
          {
            feature: 'memberships',
            extra: {
              organizationId,
              saleId,
              saleItemId: item.id,
              code: result.error.code,
            },
          }
        );
      }
    }

    return ok({ provisioned, skipped, failed });
  } catch (error) {
    logError('memberships.retryMembershipProvision', error, {
      feature: 'memberships',
      extra: { organizationId, saleId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to retry membership provisioning'
      )
    );
  }
};

export const retryMembershipProvision = (
  db: DbConnection,
  input: RetryMembershipProvisionInput
) =>
  trackedResult(
    'memberships.retryMembershipProvision',
    () => retryMembershipProvisionImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        saleId: input.saleId,
      },
    }
  );

export type RetryMembershipProvisionServiceResult = Awaited<
  ReturnType<typeof retryMembershipProvision>
>;
