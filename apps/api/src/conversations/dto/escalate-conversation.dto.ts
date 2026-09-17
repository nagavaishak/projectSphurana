import { escalateConversationSchema } from '@borradh-workspace/features/conversations';
import { createZodDto } from 'nestjs-zod';

export class EscalateConversationDto extends createZodDto(
  escalateConversationSchema.omit({ conversationId: true })
) {}
