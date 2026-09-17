import {
  createLeadFormSchema,
  leadFormQuestionSchema,
} from '@borradh-workspace/features/lead-forms';
import { createZodDto } from 'nestjs-zod';

// Re-export the question schema for use in DTOs
export const leadFormQuestionDtoSchema = leadFormQuestionSchema;

export class CreateLeadFormDto extends createZodDto(
  createLeadFormSchema.omit({ organizationId: true, createdById: true })
) {}
