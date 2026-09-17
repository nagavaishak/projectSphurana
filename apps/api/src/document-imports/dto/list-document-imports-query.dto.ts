import { documentImportStatusValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `?status=needs_review,failed&limit=50` — a comma list in the query string,
 * parsed into the array the service schema expects.
 */
const listDocumentImportsQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined
    )
    .pipe(z.array(z.enum(documentImportStatusValues)).optional()),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

export class ListDocumentImportsQueryDto extends createZodDto(
  listDocumentImportsQuerySchema
) {}
