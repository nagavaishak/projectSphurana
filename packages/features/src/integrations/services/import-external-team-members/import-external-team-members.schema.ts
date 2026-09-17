import { z } from 'zod';

export const importExternalTeamMembersSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  bookingAccountId: z.string().min(1, 'Booking account ID is required'),
  members: z
    .array(
      z.object({
        externalId: z.string().min(1),
        name: z.string().min(1),
        email: z.string().email(),
        selected: z.boolean(),
      })
    )
    .min(1, 'At least one member is required'),
});

export type ImportExternalTeamMembersInput = z.infer<
  typeof importExternalTeamMembersSchema
>;
