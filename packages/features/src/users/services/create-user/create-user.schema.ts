import { z } from 'zod';

/**
 * Schema for creating a new user
 */
export const createUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  name: z.string().min(2, 'Name must be at least 2 characters'),
  organizationId: z.string().uuid('Invalid organization ID').optional(),
});

/**
 * Input type inferred from schema
 */
export type CreateUserInput = z.infer<typeof createUserSchema>;
