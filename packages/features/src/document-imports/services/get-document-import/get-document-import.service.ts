import { documentImport, withOrgScope } from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';

export const getDocumentImportSchema = z.object({
  organizationId: z.string().min(1, 'Organization is required'),
  importId: z.string().min(1, 'Import is required'),
});

export type GetDocumentImportInput = z.infer<typeof getDocumentImportSchema>;

const getDocumentImportImpl = async (
  db: DbConnection,
  input: GetDocumentImportInput
): Promise<Result<typeof documentImport.$inferSelect>> => {
  const parsed = getDocumentImportSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, importId } = parsed.data;

  const row = await withOrgScope(
    (tx) =>
      tx.query.documentImport.findFirst({
        where: and(
          eq(documentImport.id, importId),
          eq(documentImport.organizationId, organizationId),
          notDeleted(documentImport)
        ),
      }),
    { db }
  );
  if (!row) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Import not found'));
  }
  return ok(row);
};

export const getDocumentImport = (
  db: DbConnection,
  input: GetDocumentImportInput
) =>
  trackedResult(
    'documentImports.getDocumentImport',
    () => getDocumentImportImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        importId: input.importId,
      },
      internalErrorsOnly: true,
    }
  );

export type GetDocumentImportResult = Awaited<
  ReturnType<typeof getDocumentImport>
>;
