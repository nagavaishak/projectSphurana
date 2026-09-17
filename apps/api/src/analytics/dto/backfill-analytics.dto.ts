import { backfillAnalyticsSchema } from '@borradh-workspace/features/analytics';
import { createZodDto } from 'nestjs-zod';

export class BackfillAnalyticsDto extends createZodDto(
  backfillAnalyticsSchema
) {}
