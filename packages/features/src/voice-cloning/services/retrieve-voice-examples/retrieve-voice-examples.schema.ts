import { z } from 'zod';

export const retrieveVoiceExamplesSchema = z.object({
  organizationId: z.string().min(1),
  customerMessage: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});

export type RetrieveVoiceExamplesInput = z.infer<
  typeof retrieveVoiceExamplesSchema
>;
