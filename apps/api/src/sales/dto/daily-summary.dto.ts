import { getDailySummarySchema } from '@borradh-workspace/features/sales';
import { createZodDto } from 'nestjs-zod';

export class DailySummaryDto extends createZodDto(
  getDailySummarySchema.omit({ organizationId: true })
) {}
