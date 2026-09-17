import { toggleInstagramChatbotRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `toggleInstagramChatbotRequestBase` in
 * `packages/contracts/src/requests/organizations.ts`.
 */
export const toggleInstagramChatbotSchema =
  toggleInstagramChatbotRequestBase.extend({
    organizationId: z.string().min(1),
  });

export type ToggleInstagramChatbotInput = z.infer<
  typeof toggleInstagramChatbotSchema
>;
