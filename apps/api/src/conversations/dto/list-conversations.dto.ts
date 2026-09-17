import { conversationStatusValues } from '@borradh-workspace/labels';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listConversationsQuerySchema = z.object({
  chatbotId: z.string().min(1).optional(),
  // DERIVED from the labels vocabulary.
  status: z.enum(conversationStatusValues).optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
});

export class ListConversationsDto extends createZodDto(
  listConversationsQuerySchema
) {}
