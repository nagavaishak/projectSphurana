import { z } from 'zod';

export const createAccountSessionSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  userEmail: z.string().email().optional(),
  // Optional narrowing of the enabled embedded components
  components: z.array(z.string().min(1)).optional(),
});

export type CreateAccountSessionInput = z.input<
  typeof createAccountSessionSchema
>;
