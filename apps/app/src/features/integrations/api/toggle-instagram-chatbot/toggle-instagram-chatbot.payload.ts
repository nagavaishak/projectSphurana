import { toggleInstagramChatbotRequestSchema } from '@borradh-workspace/contracts';
import type { z } from 'zod';

/**
 * Intent for `PUT integrations/instagram/chatbot`: whether the Instagram
 * chatbot should be enabled. Each surface passes its own toggle value — the
 * three-way toggle in chatbot-page-toggles, the per-channel switch in the
 * Facebook settings dialog, and the enable-only onboarding prompt.
 */
export interface ToggleInstagramChatbotInput {
  enabled: boolean;
}

/**
 * The wire body, built in exactly one place — the CANONICAL request contract
 * (`packages/contracts/src/requests/organizations.ts`), which the backend
 * feature schema also derives from. `.strict()` so the three callers that used
 * to inline `{ enabled }` can never send a diverging shape.
 */
export const toggleInstagramChatbotBodySchema =
  toggleInstagramChatbotRequestSchema;

export type ToggleInstagramChatbotBody = z.infer<
  typeof toggleInstagramChatbotBodySchema
>;

export function buildToggleInstagramChatbotPayload(
  input: ToggleInstagramChatbotInput
): ToggleInstagramChatbotBody {
  return toggleInstagramChatbotBodySchema.parse({ enabled: input.enabled });
}
