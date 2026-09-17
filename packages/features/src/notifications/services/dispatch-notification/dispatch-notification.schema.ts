import { notificationTypeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

export const dispatchNotificationSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  type: z.enum(notificationTypeValues),
  title: z.string().min(1, 'Title is required'),
  body: z.string().min(1, 'Body is required'),
  // Optional in-app deep link (relative path).
  linkPath: z.string().optional(),
  // Optional structured payload for the UI.
  data: z.record(z.string(), z.unknown()).optional(),
  // The user the event "belongs to" (e.g. the appointment's assignee). Used to
  // resolve "mine"-scoped preferences. Omit for org-wide events.
  assigneeUserId: z.string().optional(),
});

export type DispatchNotificationInput = z.infer<
  typeof dispatchNotificationSchema
>;
