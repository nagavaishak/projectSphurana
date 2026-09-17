import { z } from 'zod';

export const listExternalTeamMembersSchema = z.object({
  bookingAccountId: z.string().min(1, 'Booking account ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
});

export type ListExternalTeamMembersInput = z.infer<
  typeof listExternalTeamMembersSchema
>;

export interface ExternalTeamMember {
  externalId: string;
  name: string;
  email: string;
  avatarUrl?: string;
  schedulingUrl?: string;
}
