import { leadFormStatusValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listLeadFormsDtoSchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
  offset: z.coerce.number().int().min(0).optional().default(0),
  // DERIVED from the labels vocabulary.
  status: z.enum(leadFormStatusValues).optional(),
});

export class ListLeadFormsDto extends createZodDto(listLeadFormsDtoSchema) {}
