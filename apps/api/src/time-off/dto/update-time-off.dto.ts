import { updateTimeOffRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateTimeOffDto extends createZodDto(
  updateTimeOffRequestSchema
) {}
