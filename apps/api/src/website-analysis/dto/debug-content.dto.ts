import { debugContentSchema } from '@borradh-workspace/features/website-analysis';
import { createZodDto } from 'nestjs-zod';

export class DebugContentDto extends createZodDto(debugContentSchema) {}
