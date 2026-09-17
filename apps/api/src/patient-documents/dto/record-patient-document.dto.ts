import { createPatientDocumentSchema } from '@borradh-workspace/features/patient-documents';
import { createZodDto } from 'nestjs-zod';

/**
 * Post-upload record call: `{ key, fileName, mimeType, sizeBytes }`.
 * Scoping ids and uploader attribution come from the server session, never
 * the body.
 */
export class RecordPatientDocumentDto extends createZodDto(
  createPatientDocumentSchema.omit({
    organizationId: true,
    leadId: true,
    uploadedByType: true,
    uploadedByUserId: true,
  })
) {}
