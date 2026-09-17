import { addVideoClipSchema } from '@borradh-workspace/features/videos';
import { createZodDto } from 'nestjs-zod';

export class AddVideoClipDto extends createZodDto(
  addVideoClipSchema.omit({ videoId: true })
) {}
