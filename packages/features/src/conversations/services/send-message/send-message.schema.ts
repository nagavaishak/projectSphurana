import { sendMessageRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `packages/contracts/src/requests/
 * conversations.ts`. The client sends only `content`; the conversation is the
 * route param, the org comes from the session, and `userId` is the
 * authenticated agent (never client-supplied — it stamps authorship).
 */
export const sendMessageSchema = sendMessageRequestBase.extend({
  conversationId: z.string().min(1, 'Conversation ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
