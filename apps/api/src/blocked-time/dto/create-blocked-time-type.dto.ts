import { createBlockedTimeTypeRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateBlockedTimeTypeDto extends createZodDto(
  createBlockedTimeTypeRequestSchema
) {}
