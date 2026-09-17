import { type Lead, leadForm, withOrgScope } from '@borradh-workspace/database';
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
import { type GetLeadInput, getLeadSchema } from './get-lead.schema.js';

/**
 * The lead form a lead originated from (only for `meta_lead_form` leads).
 * Resolved from the Meta `form_id` stored on the lead's `formData`.
 */
export interface SourceLeadForm {
  id: string;
  name: string;
}

/**
 * A lead enriched with its originating lead form, for the detail view.
 */
export interface LeadDetail extends Lead {
  sourceLeadForm: SourceLeadForm | null;
}

/**
 * Resolve the originating lead form for a meta lead-form lead.
 *
 * Meta-form leads store the Meta `form_id` on `formData` (set by the lead
 * webhook handler), not our internal lead form id, so we look the form up by
 * its `metaFormId`. Best-effort — returns null when there's no match.
 */
const resolveSourceLeadForm = async (
  db: DbConnection,
  lead: Lead
): Promise<SourceLeadForm | null> => {
  if (lead.source !== 'meta_lead_form') return null;

  const formData = lead.formData as { form_id?: unknown } | null;
  const metaFormId =
    typeof formData?.form_id === 'string' ? formData.form_id : null;
  if (!metaFormId) return null;

  const form = await db.query.leadForm.findFirst({
    where: and(
      eq(leadForm.metaFormId, metaFormId),
      eq(leadForm.organizationId, lead.organizationId)
    ),
    columns: { id: true, name: true },
  });

  return form ?? null;
};

/**
 * Internal implementation of get lead
 */
const getLeadImpl = async (
  db: DbConnection,
  input: GetLeadInput
): Promise<Result<LeadDetail>> => {
  // Validate input
  const parsed = getLeadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Fetch lead
  const result = await db.query.lead.findFirst({
    where: (lead, { eq, and, isNull }) =>
      and(
        eq(lead.id, parsed.data.id),
        eq(lead.organizationId, parsed.data.organizationId),
        isNull(lead.deletedAt)
      ),
  });

  if (!result) {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Lead with ID ${parsed.data.id} not found`,
        { id: parsed.data.id }
      )
    );
  }

  const sourceLeadForm = await resolveSourceLeadForm(db, result);

  return ok({ ...result, sourceLeadForm });
};

/**
 * Get a lead by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Lead query input
 * @returns Result with lead or error
 *
 * @example
 * ```ts
 * const result = await getLead(db, {
 *   id: 'lead_123',
 *   organizationId: 'org_123',
 * });
 * ```
 */
export const getLead = (db: DbConnection, input: GetLeadInput) =>
  trackedResult(
    'leads.getLead',
    () => withOrgScope((tx) => getLeadImpl(tx, input), { db }),
    { properties: { leadId: input.id }, internalErrorsOnly: true }
  );

/**
 * Result type for getLead
 */
export type GetLeadResult = Awaited<ReturnType<typeof getLead>>;
