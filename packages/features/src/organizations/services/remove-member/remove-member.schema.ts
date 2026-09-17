import { z } from 'zod';

/**
 * Schema for removing a member from an organization
 */
export const removeMemberSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  requesterId: z.string().min(1, 'Requester user ID is required'),
});

/**
 * Input type inferred from schema
 */
export type RemoveMemberInput = z.infer<typeof removeMemberSchema>;
