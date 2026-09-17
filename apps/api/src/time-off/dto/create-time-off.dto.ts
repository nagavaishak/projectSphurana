import { createTimeOffRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class CreateTimeOffDto extends createZodDto(
  createTimeOffRequestSchema
) {}
