import { z } from 'zod';

export const initiateStripeConnectSchema = z.object({
  organizationId: z.string().min(1),
  userId: z.string().min(1).optional(),
  redirectUri: z.string().url(),
  organizationEmail: z.string().email().optional(),
  returnTo: z.string().optional(),
});

export type InitiateStripeConnectInput = z.infer<
  typeof initiateStripeConnectSchema
>;
