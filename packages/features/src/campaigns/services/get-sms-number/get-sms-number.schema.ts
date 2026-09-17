import { z } from 'zod';

export const getSmsNumberSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetSmsNumberInput = z.infer<typeof getSmsNumberSchema>;
