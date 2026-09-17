import { generateTitleSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

export class GenerateTitleDto extends createZodDto(
  generateTitleSchema.omit({
    conversationId: true,
    organizationId: true,
    userId: true,
  })
) {}
