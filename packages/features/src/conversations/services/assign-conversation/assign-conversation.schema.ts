import { assignConversationRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * conversations.ts`.
 */
export const assignConversationSchema = assignConversationRequestBase.extend({
  id: z.string().min(1, 'Conversation ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type AssignConversationInput = z.infer<typeof assignConversationSchema>;
