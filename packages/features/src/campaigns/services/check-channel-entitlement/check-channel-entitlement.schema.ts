import { z } from 'zod';

export const checkChannelEntitlementSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  channels: z
    .array(z.enum(['email', 'sms', 'whatsapp']))
    .min(1, 'At least one channel is required'),
});

export type CheckChannelEntitlementInput = z.infer<
  typeof checkChannelEntitlementSchema
>;
