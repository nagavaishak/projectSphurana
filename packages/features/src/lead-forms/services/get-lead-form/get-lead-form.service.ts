import {
  type LeadForm,
  leadForm,
  withOrgScope,
} from '@borradh-workspace/database';
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
import {
  type GetLeadFormInput,
  getLeadFormSchema,
} from './get-lead-form.schema.js';

/**
 * Internal implementation of get lead form
 */
const getLeadFormImpl = async (
  db: DbConnection,
  input: GetLeadFormInput
): Promise<Result<LeadForm>> => {
  // Validate input
  const parsed = getLeadFormSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  // Build where clause
  const conditions = [eq(leadForm.id, parsed.data.id)];
  if (parsed.data.organizationId) {
    conditions.push(eq(leadForm.organizationId, parsed.data.organizationId));
  }

  // Get the lead form
  const form = await db.query.leadForm.findFirst({
    where: and(...conditions),
    with: {
      metaPage: true,
      createdBy: {
        columns: {
          id: true,
          name: true,
          email: true,
        },
      },
    },
  });

  if (!form) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Lead form not found', {
        id: parsed.data.id,
      })
    );
  }

  return ok(form);
};

/**
 * Get a lead form by ID
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - Get input with lead form ID
 * @returns Result with lead form or error
 *
 * @example
 * ```ts
 * const result = await getLeadForm(db, {
 *   id: 'form_123',
 *   organizationId: 'org_123', // Optional for access control
 * });
 * ```
 */
export const getLeadForm = (db: DbConnection, input: GetLeadFormInput) =>
  trackedResult(
    'leadForms.getLeadForm',
    () => withOrgScope((tx) => getLeadFormImpl(tx, input), { db }),
    { properties: { id: input.id }, internalErrorsOnly: true }
  );

/**
 * Result type for getLeadForm
 */
export type GetLeadFormResult = Awaited<ReturnType<typeof getLeadForm>>;
