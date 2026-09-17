import { updateVideoRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class UpdateVideoDto extends createZodDto(updateVideoRequestSchema) {}
