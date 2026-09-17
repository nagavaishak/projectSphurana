import { z } from 'zod';

export const requestClaireHandoffSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  // Used to get-or-create the Intercom contact before opening a conversation
  // so a server-side handoff doesn't fail with "User Not Found" when the user
  // has never opened the messenger. Optional — falls back to external_id only.
  userEmail: z.string().email().optional(),
  userName: z.string().min(1).optional(),
  // Plain-language summary Claire gives the agent before they pick up. Shown
  // as the first line of the seeded Intercom message above the transcript.
  reason: z.string().min(1).max(500),
  // Cap on how many of the most-recent messages we seed into the Intercom
  // body. Keeps the initial Intercom message readable when conversations
  // run long.
  transcriptMaxMessages: z.number().int().min(1).max(50).default(20),
});

export type RequestClaireHandoffInput = z.input<
  typeof requestClaireHandoffSchema
>;
