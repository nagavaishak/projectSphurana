import { z } from 'zod';

export const undoRegenerateSchema = z.object({
  itemId: z.string().min(1, 'Item ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type UndoRegenerateInput = z.infer<typeof undoRegenerateSchema>;
