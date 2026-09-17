import { z } from 'zod';

export const getGiftCardSchema = z
  .object({
    organizationId: z.string().min(1),
    giftCardId: z.string().min(1).optional(),
    code: z.string().min(1).optional(),
  })
  .refine((v) => Boolean(v.giftCardId) !== Boolean(v.code), {
    message: 'Provide exactly one of giftCardId or code',
  });

export type GetGiftCardInput = z.input<typeof getGiftCardSchema>;
