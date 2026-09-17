import { updateBlockedTimeTypeRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateBlockedTimeTypeDto extends createZodDto(
  updateBlockedTimeTypeRequestSchema
) {}
