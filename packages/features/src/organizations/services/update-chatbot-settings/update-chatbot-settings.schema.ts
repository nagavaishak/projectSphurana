import { updateChatbotSettingsRequestBase } from '@borradh-workspace/contracts';
import { z } from 'zod';

/**
 * DERIVED from the wire contract — see `updateChatbotSettingsRequestBase` in
 * `packages/contracts/src/requests/organizations.ts`. The nested
 * chatbot-settings / FAQ / consultation shapes live there.
 */
export const updateChatbotSettingsSchema =
  updateChatbotSettingsRequestBase.extend({
    organizationId: z.string().min(1, 'Organization ID is required'),
  });

export type UpdateChatbotSettingsInput = z.infer<
  typeof updateChatbotSettingsSchema
>;
