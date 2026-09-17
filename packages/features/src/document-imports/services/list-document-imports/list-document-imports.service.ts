import {
  documentImport,
  lead,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, desc, eq, inArray } from 'drizzle-orm';
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
  type ListDocumentImportsInput,
  listDocumentImportsSchema,
} from './list-document-imports.schema.js';

export type DocumentImportListItem = typeof documentImport.$inferSelect & {
  /** Display name of the matched client, so the list needs no second fetch. */
  matchedLeadName: string | null;
};

export interface DocumentImportList {
  items: DocumentImportListItem[];
}

/**
 * The import dialog's list: newest first, org-scoped, discarded rows
 * (soft-deleted) excluded. Polled while anything is still in flight.
 */
const listDocumentImportsImpl = async (
  db: DbConnection,
  input: ListDocumentImportsInput
): Promise<Result<DocumentImportList>> => {
  const parsed = listDocumentImportsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, status, limit } = parsed.data;

  const items = await withOrgScope(
    async (tx) => {
      const rows = await tx.query.documentImport.findMany({
        where: and(
          eq(documentImport.organizationId, organizationId),
          notDeleted(documentImport),
          status && status.length > 0
            ? inArray(documentImport.status, status)
            : undefined
        ),
        orderBy: [desc(documentImport.createdAt)],
        limit,
      });

      const leadIds = [
        ...new Set(
          rows
            .map((r) => r.matchedLeadId)
            .filter((id): id is string => Boolean(id))
        ),
      ];
      const leads =
        leadIds.length > 0
          ? await tx.query.lead.findMany({
              where: and(
                eq(lead.organizationId, organizationId),
                inArray(lead.id, leadIds)
              ),
              columns: { id: true, firstName: true, lastName: true },
            })
          : [];
      const names = new Map(
        leads.map((l) => [
          l.id,
          l.lastName ? `${l.firstName} ${l.lastName}` : l.firstName,
        ])
      );

      return rows.map(
        (row): DocumentImportListItem => ({
          ...row,
          matchedLeadName: row.matchedLeadId
            ? (names.get(row.matchedLeadId) ?? null)
            : null,
        })
      );
    },
    { db }
  );

  return ok({ items });
};

export const listDocumentImports = (
  db: DbConnection,
  input: ListDocumentImportsInput
) =>
  trackedResult(
    'documentImports.listDocumentImports',
    () => listDocumentImportsImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type ListDocumentImportsResult = Awaited<
  ReturnType<typeof listDocumentImports>
>;
