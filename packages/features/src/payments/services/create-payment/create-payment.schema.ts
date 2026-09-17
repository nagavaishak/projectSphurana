import { externalRedirectUrl } from '@borradh-workspace/contracts';
import { z } from 'zod';

export const createPaymentSchema = z.object({
  organizationId: z.string().min(1),
  leadId: z.string().min(1).optional(),
  amountCents: z.number().int().positive(),
  currency: z.string().default('eur'),
  description: z.string().min(1, 'Description is required'),
  customerEmail: z.string().email().optional(),
  customerName: z.string().optional(),
  expirationHours: z.number().int().min(1).max(168).optional(), // 1h to 7 days
  successUrl: externalRedirectUrl,
  cancelUrl: externalRedirectUrl,
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
