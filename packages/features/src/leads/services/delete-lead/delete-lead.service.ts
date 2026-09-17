import { lead, withOrgScope } from '@borradh-workspace/database';
import {
  isFeatureOn,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  SIGNED_CONSENT_BLOCKS_DELETE,
  releasePendingConsentForms,
} from '../../../consent-forms/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  logAuditEvent,
  notDeleted,
  ok,
  softDeleteLeadChildren,
} from '../../../shared/index.js';
import {
  type DeleteLeadInput,
  deleteLeadSchema,
} from './delete-lead.schema.js';

/**
 * Internal implementation of delete lead (runs inside withOrgScope transaction)
 */
const deleteLeadImpl = async (
  db: DbConnection,
  input: DeleteLeadInput
): Promise<Result<{ id: string }>> => {
  // Validate input
  const parsed = deleteLeadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  if (!(await isFeatureOn('killswitch-soft-deletes'))) {
    // Hard delete. `consent_form_submission.lead_id` is ON DELETE RESTRICT
    // (0136): erasing the person must not silently erase the clinical record
    // proving they consented to a treatment they already received. Pending
    // forms go; anything signed refuses the delete with a reason.
    const { signedCount } = await releasePendingConsentForms(db, {
      leadId: parsed.data.id,
    });
    if (signedCount > 0) {
      return err(
        new FeatureError(ErrorCodes.CONFLICT, SIGNED_CONSENT_BLOCKS_DELETE, {
          leadId: parsed.data.id,
          signedConsentForms: signedCount,
        })
      );
    }

    await db
      .delete(lead)
      .where(
        and(
          eq(lead.id, parsed.data.id),
          eq(lead.organizationId, parsed.data.organizationId)
        )
      );
    return ok({ id: parsed.data.id });
  }

  // Check if lead exists
  const existing = await db.query.lead.findFirst({
    where: (lead, { eq, and, isNull }) =>
      and(
        eq(lead.id, parsed.data.id),
        eq(lead.organizationId, parsed.data.organizationId),
        isNull(lead.deletedAt)
      ),
  });

  if (!existing) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Lead with ID ${parsed.data.id} not found`,
        { id: parsed.data.id }
      )
    );
  }

  await softDeleteLeadChildren(db, parsed.data.id);

  await db
    .update(lead)
    .set({ deletedAt: new Date() })
    .where(
      and(
        eq(lead.id, parsed.data.id),
        eq(lead.organizationId, parsed.data.organizationId),
        notDeleted(lead)
      )
    );

  return ok({ id: parsed.data.id });
};

/**
 * Delete a lead
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Lead delete input
 * @returns Result with deleted lead ID or error
 *
 * @example
 * ```ts
 * const result = await deleteLead(db, {
 *   id: 'lead_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const deleteLead = async (db: DbConnection, input: DeleteLeadInput) => {
  const result = await trackedResult(
    'leads.deleteLead',
    () => withOrgScope((tx) => deleteLeadImpl(tx, input), { db }),
    { properties: { leadId: input.id } }
  );
  // Audit log fires after transaction commits — safe from phantom entries on rollback
  if (result.success) {
    logAuditEvent(db, {
      action: 'delete',
      entityType: 'lead',
      entityId: result.data.id,
      actorType: 'user',
      actorId: input.actorId ?? null,
      organizationId: input.organizationId,
    }).catch((error) => {
      logError('leads.deleteLead.auditLog', error, {
        feature: 'leads',
        extra: { leadId: result.data.id, organizationId: input.organizationId },
      });
    });
  }
  return result;
};

/**
 * Result type for deleteLead
 */
export type DeleteLeadResult = Awaited<ReturnType<typeof deleteLead>>;
