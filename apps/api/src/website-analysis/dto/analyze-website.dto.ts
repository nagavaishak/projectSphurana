import { analyzeWebsiteSchema } from '@borradh-workspace/features/website-analysis';
import { createZodDto } from 'nestjs-zod';

export class AnalyzeWebsiteDto extends createZodDto(
  analyzeWebsiteSchema.omit({ organizationId: true })
) {}
