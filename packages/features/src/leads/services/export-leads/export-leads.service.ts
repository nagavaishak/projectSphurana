import { lead, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { type SQL, and, desc, eq, ilike, or } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  type ExportLeadsInput,
  exportLeadsSchema,
} from './export-leads.schema.js';

/**
 * Internal implementation of export leads
 */
const exportLeadsImpl = async (db: DbConnection, input: ExportLeadsInput) => {
  const parsed = exportLeadsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId, status, source, search } = parsed.data;

  // Build where conditions
  const conditions: SQL[] = [
    eq(lead.organizationId, organizationId),
    notDeleted(lead),
  ];

  if (status) {
    conditions.push(eq(lead.status, status));
  }

  if (source) {
    conditions.push(eq(lead.source, source));
  }

  if (search) {
    const searchTerm = `%${search}%`;
    const searchCondition = or(
      ilike(lead.firstName, searchTerm),
      ilike(lead.lastName, searchTerm),
      ilike(lead.email, searchTerm),
      ilike(lead.phone, searchTerm)
    );
    if (searchCondition) {
      conditions.push(searchCondition);
    }
  }

  const items = await db.query.lead.findMany({
    where: and(...conditions),
    orderBy: desc(lead.createdAt),
  });

  return ok({ items });
};

/**
 * Export leads for an organization (returns raw lead data)
 *
 * @param db - Database connection
 * @param input - Export filters
 * @returns Result with leads array
 */
export const exportLeads = (db: DbConnection, input: ExportLeadsInput) =>
  trackedResult(
    'leads.exportLeads',
    () => withOrgScope((tx) => exportLeadsImpl(tx, input), { db }),
    { properties: { organizationId: input.organizationId } }
  );

export type ExportLeadsResult = Awaited<ReturnType<typeof exportLeads>>;
