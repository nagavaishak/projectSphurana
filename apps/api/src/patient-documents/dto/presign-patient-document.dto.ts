import { presignPatientDocumentSchema } from '@borradh-workspace/features/patient-documents';
import { createZodDto } from 'nestjs-zod';

/**
 * Client supplies only file facts — org/lead/uploader ids are resolved
 * server-side (PatientAuthGuard principal or staff session + route param).
 */
export class PresignPatientDocumentDto extends createZodDto(
  presignPatientDocumentSchema.omit({
    organizationId: true,
    leadId: true,
    uploaderId: true,
  })
) {}
