import { z } from 'zod';

/** The identity fields the normalizer is allowed to touch. */
export const normalizeLeadSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  firstName: z.string().max(200).optional(),
  lastName: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(50).optional(),
  whatsapp: z.string().max(50).optional(),
});

export type NormalizeLeadInput = z.infer<typeof normalizeLeadSchema>;

/** Cleaned fields — only ever contains keys that were present in the input. */
export type NormalizedLeadFields = Partial<
  Pick<
    NormalizeLeadInput,
    'firstName' | 'lastName' | 'email' | 'phone' | 'whatsapp'
  >
>;
