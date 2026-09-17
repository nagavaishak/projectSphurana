import { createConversationSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

export class CreateConversationDto extends createZodDto(
  createConversationSchema.omit({ organizationId: true, userId: true })
) {}
