import { z } from 'zod';

export const sendIntercomMessageSchema = z.object({
  /** The user ID (matches external_id in Intercom) */
  userId: z.string().min(1),
  /** HTML body of the in-app message */
  messageBody: z.string().min(1),
});

export type SendIntercomMessageInput = z.infer<
  typeof sendIntercomMessageSchema
>;
