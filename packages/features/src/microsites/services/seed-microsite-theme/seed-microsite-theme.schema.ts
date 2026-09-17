import { z } from 'zod';

export const seedMicrositeThemeSchema = z.object({
  organizationId: z.string().min(1),
});

export type SeedMicrositeThemeInput = z.infer<typeof seedMicrositeThemeSchema>;
