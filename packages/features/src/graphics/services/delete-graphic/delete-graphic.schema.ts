import { z } from 'zod';

export const deleteGraphicSchema = z.object({
  id: z.string().min(1, 'Graphic ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type DeleteGraphicInput = z.infer<typeof deleteGraphicSchema>;
