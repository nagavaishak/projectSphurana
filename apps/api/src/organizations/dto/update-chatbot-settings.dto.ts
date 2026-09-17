import { updateChatbotSettingsRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** `PUT organizations/:id/chatbot-settings`. */
export class UpdateChatbotSettingsDto extends createZodDto(
  updateChatbotSettingsRequestSchema
) {}
