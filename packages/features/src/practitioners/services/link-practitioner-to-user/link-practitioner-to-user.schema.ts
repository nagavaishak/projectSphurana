import { z } from 'zod';

export const linkPractitionerToUserSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  email: z.string().email('Invalid email'),
});

export type LinkPractitionerToUserInput = z.infer<
  typeof linkPractitionerToUserSchema
>;
