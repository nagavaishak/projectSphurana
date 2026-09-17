import { z } from 'zod';

export const generateTitleSchema = z.object({
  conversationId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  userMessage: z.string().min(1),
  assistantResponse: z.string().min(1),
});

export type GenerateTitleInput = z.infer<typeof generateTitleSchema>;
