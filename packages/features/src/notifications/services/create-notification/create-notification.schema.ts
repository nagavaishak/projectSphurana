import { notificationTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const createNotificationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  type: z.enum(notificationTypeValues),
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  // Optional in-app deep link (relative path, e.g. /dashboard/appointments).
  linkPath: z.string().optional(),
  // Optional structured payload for the UI.
  data: z.record(z.string(), z.unknown()).optional(),
  // Extra delivery channels beyond the always-on in-app feed row.
  channels: z.object({ email: z.boolean(), push: z.boolean() }).optional(),
  // Required for the email channel to actually send.
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().optional(),
});

export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;
