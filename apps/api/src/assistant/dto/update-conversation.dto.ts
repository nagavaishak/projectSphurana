import { updateConversationSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

export class UpdateConversationDto extends createZodDto(
  updateConversationSchema.omit({
    id: true,
    organizationId: true,
    userId: true,
  })
) {}
