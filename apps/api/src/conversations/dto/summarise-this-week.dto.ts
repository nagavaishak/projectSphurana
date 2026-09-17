import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const summariseThisWeekQuerySchema = z.object({
  since: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO datetime — start of window. Defaults to 7 days ago.'),
  until: z
    .string()
    .datetime({ offset: true })
    .optional()
    .describe('ISO datetime — end of window. Defaults to now.'),
});

export class SummariseThisWeekDto extends createZodDto(
  summariseThisWeekQuerySchema
) {}
