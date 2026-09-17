import { z } from 'zod';

export const analyzeStyleSchema = z.object({
  organizationId: z.string().min(1),
  messages: z.array(z.string()).min(10).max(200),
});

export type AnalyzeStyleInput = z.infer<typeof analyzeStyleSchema>;
