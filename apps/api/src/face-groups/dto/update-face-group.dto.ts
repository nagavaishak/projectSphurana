import { updateFaceGroupRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateFaceGroupDto extends createZodDto(
  updateFaceGroupRequestSchema
) {}
