import {
  type LeadForm,
  leadForm,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListLeadFormsInput,
  listLeadFormsSchema,
} from './list-lead-forms.schema.js';

export interface ListLeadFormsResult {
  items: LeadForm[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Internal implementation of list lead forms
 */
const listLeadFormsImpl = async (
  db: DbConnection,
  input: ListLeadFormsInput
): Promise<Result<ListLeadFormsResult>> => {
  // Validate input
  const parsed = listLeadFormsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, limit, offset } = parsed.data;

  // Build where conditions
  const conditions = [eq(leadForm.organizationId, organizationId)];
  if (status) {
    conditions.push(eq(leadForm.status, status));
  }

  // Get forms with pagination
  const items = await db.query.leadForm.findMany({
    where: and(...conditions),
    limit,
    offset,
    orderBy: [desc(leadForm.createdAt)],
    with: {
      metaPage: true,
    },
  });

  // Get total count
  const allForms = await db.query.leadForm.findMany({
    where: and(...conditions),
    columns: { id: true },
  });
  const total = allForms.length;

  return ok({
    items,
    total,
    limit: limit ?? 20,
    offset: offset ?? 0,
  });
};

/**
 * List lead forms for an organization
 *
 * @param db - Database connection (can be db or transaction)
 * @param input - List input with filters
 * @returns Result with paginated lead forms or error
 *
 * @example
 * ```ts
 * const result = await listLeadForms(db, {
 *   organizationId: 'org_123',
 *   status: 'synced',
 *   limit: 20,
 *   offset: 0,
 * });
 * ```
 */
export const listLeadForms = (db: DbConnection, input: ListLeadFormsInput) =>
  trackedResult(
    'leadForms.listLeadForms',
    () => withOrgScope((tx) => listLeadFormsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

/**
 * Result type for listLeadForms
 */
export type ListLeadFormsServiceResult = Awaited<
  ReturnType<typeof listLeadForms>
>;
