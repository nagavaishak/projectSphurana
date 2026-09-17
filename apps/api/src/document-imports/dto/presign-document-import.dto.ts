import { presignDocumentImportSchema } from '@borradh-workspace/features/document-imports';
import { createZodDto } from 'nestjs-zod';

/** Client supplies only file facts — org and uploader come from the session. */
export class PresignDocumentImportDto extends createZodDto(
  presignDocumentImportSchema.omit({ organizationId: true, uploaderId: true })
) {}
