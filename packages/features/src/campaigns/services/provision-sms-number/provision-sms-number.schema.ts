import { z } from 'zod';

export const provisionSmsNumberSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** E.164 number chosen from a prior search (e.g. +353871234567). */
  phoneNumber: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Invalid phone number'),
  /** ISO 3166-1 alpha-2 country code the number belongs to. */
  country: z
    .string()
    .length(2, 'Country must be a 2-letter code')
    .transform((c) => c.toUpperCase()),
  /** Twilio SMS webhook (STOP handling); set by the API from config. */
  smsWebhookUrl: z.string().url().optional(),
});

export type ProvisionSmsNumberInput = z.infer<typeof provisionSmsNumberSchema>;
