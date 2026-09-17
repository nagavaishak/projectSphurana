import { queryBoolean } from '@borradh-workspace/features/shared';
import {
  leadSourceValues,
  leadStageGroupValues,
  leadStatusValues,
} from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Inline schema to avoid deep type recursion from .omit() operations.
// Enums are DERIVED from the labels vocabulary — hand-typed copies had drifted,
// so filtering by `booked` or by `whatsapp` / `meta_lead_form` 400'd.
const listLeadsBodySchema = z.object({
  status: z.enum(leadStatusValues).optional(),
  // Customers-surface tab filter: all | leads | contacted | booked.
  stageGroup: z.enum(leadStageGroupValues).optional(),
  source: z.enum(leadSourceValues).optional(),
  // Result ordering for the Clients surface (mirrors the feature schema's
  // `sort`). Must be listed here too — this DTO is a hand-rolled copy, so an
  // omitted field is stripped by the ValidationPipe before it reaches the
  // service.
  sort: z.enum(['smart', 'recent', 'oldest', 'name', 'last_visit']).optional(),
  sequenceId: z.string().optional(),
  assignedToId: z.string().optional(),
  search: z.string().optional(),
  tags: z.preprocess(
    (val) => (typeof val === 'string' ? val.split(',').filter(Boolean) : val),
    z.array(z.string()).optional()
  ),
  consentEmail: z.coerce.boolean().optional(),
  consentSms: z.coerce.boolean().optional(),
  consentVoice: z.coerce.boolean().optional(),
  // The SAME helper the feature schema uses. This was a second, hand-rolled
  // preprocess, which is how the two drifted: the service kept
  // `z.coerce.boolean()` and inverted the filter for every non-HTTP caller,
  // and this copy read `?hasEmail=` (an untouched form field) as true.
  hasEmail: queryBoolean(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
});

export class ListLeadsDto extends createZodDto(listLeadsBodySchema) {}
