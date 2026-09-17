import { assignDocumentImportSchema } from '@borradh-workspace/features/document-imports';
import { createZodDto } from 'nestjs-zod';

/** `{ leadId }` — import id is the route param, actor is the session user. */
export class AssignDocumentImportDto extends createZodDto(
  assignDocumentImportSchema.omit({
    organizationId: true,
    importId: true,
    actorUserId: true,
  })
) {}
