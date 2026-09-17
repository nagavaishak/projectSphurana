import { z } from 'zod';

export const getPractitionerForUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type GetPractitionerForUserInput = z.infer<
  typeof getPractitionerForUserSchema
>;
