import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST microsites/:id/chat`.
 *
 * `confirmedActions` is how the SIDEBAR answers a confirmation request
 * (contract §3): the user clicks confirm, the sidebar replays the turn with
 * the action key it was handed. It is a request field precisely so the model
 * cannot produce one.
 */
const micrositeChatSchema = z.object({
  prompt: z.string().trim().min(1, 'Message is required').max(4000),
  conversationId: z.string().min(1).optional(),
  selection: z
    .object({
      pageId: z.string().min(1).optional(),
      blockId: z.string().min(1),
    })
    .optional(),
  confirmedActions: z.array(z.string().min(1)).max(10).optional(),
});

export class MicrositeChatDto extends createZodDto(micrositeChatSchema) {}
