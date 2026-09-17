import { lead, withOrgScope } from '@borradh-workspace/database';
import { trackOrgEvent, trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type UpdateLeadInput,
  updateLeadSchema,
} from './update-lead.schema.js';

/**
 * Internal implementation of update lead
 */
const updateLeadImpl = async (
  db: DbConnection,
  input: UpdateLeadInput
): Promise<Result<typeof result>> => {
  // Validate input
  const parsed = updateLeadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
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

  // Build update object (only include provided fields)
  const updateData: Record<string, unknown> = {};
  if (parsed.data.firstName !== undefined)
    updateData.firstName = parsed.data.firstName;
  if (parsed.data.lastName !== undefined)
    updateData.lastName = parsed.data.lastName;
  if (parsed.data.email !== undefined) updateData.email = parsed.data.email;
  if (parsed.data.phone !== undefined) updateData.phone = parsed.data.phone;
  if (parsed.data.whatsapp !== undefined)
    updateData.whatsapp = parsed.data.whatsapp;
  if (parsed.data.source !== undefined) updateData.source = parsed.data.source;
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.assignedToId !== undefined)
    updateData.assignedToId = parsed.data.assignedToId;
  if (parsed.data.tags !== undefined) updateData.tags = parsed.data.tags;
  if (parsed.data.notes !== undefined) updateData.notes = parsed.data.notes;
  if (parsed.data.portalNote !== undefined) {
    updateData.portalNote = parsed.data.portalNote;
  }
  if (parsed.data.metadata !== undefined)
    updateData.metadata = parsed.data.metadata;

  // Consent fields
  let consentChanged = false;
  if (parsed.data.consentEmail !== undefined) {
    updateData.consentEmail = parsed.data.consentEmail;
    consentChanged = true;
  }
  if (parsed.data.consentSms !== undefined) {
    updateData.consentSms = parsed.data.consentSms;
    consentChanged = true;
  }
  if (parsed.data.consentVoice !== undefined) {
    updateData.consentVoice = parsed.data.consentVoice;
    consentChanged = true;
  }
  if (consentChanged) {
    updateData.consentSource = 'user_update';
    updateData.consentedAt = new Date();
  }

  // Update lead
  const [result] = await db
    .update(lead)
    .set(updateData)
    .where(
      and(
        eq(lead.id, parsed.data.id),
        eq(lead.organizationId, parsed.data.organizationId),
        notDeleted(lead)
      )
    )
    .returning();

  // Track status changes for analytics
  if (
    parsed.data.status !== undefined &&
    parsed.data.status !== existing.status
  ) {
    trackOrgEvent(parsed.data.organizationId, 'lead_status_changed', {
      leadId: parsed.data.id,
      fromStatus: existing.status,
      toStatus: parsed.data.status,
      source: existing.source,
    });
  }

  return ok(result);
};

/**
 * Update a lead
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Lead update input
 * @returns Result with updated lead or error
 *
 * @example
 * ```ts
 * const result = await updateLead(db, {
 *   id: 'lead_123',
 *   organizationId: 'org_123',
 *   status: 'contacted',
 * });
 * ```
 */
export const updateLead = (db: DbConnection, input: UpdateLeadInput) =>
  trackedResult(
    'leads.updateLead',
    () => withOrgScope((tx) => updateLeadImpl(tx, input), { db }),
    { properties: { leadId: input.id } }
  );

/**
 * Result type for updateLead
 */
export type UpdateLeadResult = Awaited<ReturnType<typeof updateLead>>;
