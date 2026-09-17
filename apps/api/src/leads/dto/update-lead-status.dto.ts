import { leadStatusValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// DERIVED from the labels vocabulary. The hand-typed copy omitted `booked` and
// `cold`, which the lead board can produce — dragging a lead into those columns
// 400'd.
const updateLeadStatusSchema = z.object({
  status: z.enum(leadStatusValues),
});

export class UpdateLeadStatusDto extends createZodDto(updateLeadStatusSchema) {}
