import { z } from 'zod';

export const testCallSchema = z.object({
  to: z.string().min(1, 'Phone number is required'),
  agentConfigId: z.string().min(1, 'Agent configuration ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type TestCallInput = z.infer<typeof testCallSchema>;
