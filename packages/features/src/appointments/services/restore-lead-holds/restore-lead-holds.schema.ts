import { z } from 'zod';

export const restoreLeadHoldsSchema = z.object({
  organizationId: z.string().min(1),
  holds: z
    .array(
      z.object({
        id: z.string().min(1),
        // The clock the hold carried before it was released. Restored as-is
        // rather than re-derived: a fresh window would silently extend the
        // reservation past what the customer was told.
        holdExpiresAt: z.date().nullable(),
      })
    )
    .default([]),
});

export type RestoreLeadHoldsInput = z.infer<typeof restoreLeadHoldsSchema>;
