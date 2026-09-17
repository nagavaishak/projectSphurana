import { transcribeVideoSchema } from '@borradh-workspace/features/videos';
import { createZodDto } from 'nestjs-zod';

export class TranscribeVideoDto extends createZodDto(
  transcribeVideoSchema.omit({ id: true, organizationId: true })
) {}
