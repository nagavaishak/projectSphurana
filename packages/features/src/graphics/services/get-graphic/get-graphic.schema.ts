import { z } from 'zod';

export const getGraphicSchema = z.object({
  id: z.string().min(1, 'Graphic ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetGraphicInput = z.infer<typeof getGraphicSchema>;
