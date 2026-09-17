import { z } from 'zod';
export const seedIntakeTemplatesSchema = z.object({
  organizationId: z.string().min(1),
  // Which templates to seed; defaults to all.
  keys: z.array(z.string()).optional(),
  createdById: z.string().optional(),
});
export type SeedIntakeTemplatesInput = z.infer<
  typeof seedIntakeTemplatesSchema
>;
