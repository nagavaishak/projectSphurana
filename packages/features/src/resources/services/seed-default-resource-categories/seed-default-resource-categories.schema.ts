import { z } from 'zod';

export const seedDefaultResourceCategoriesSchema = z.object({
  organizationId: z.string().min(1),
});

export type SeedDefaultResourceCategoriesInput = z.infer<
  typeof seedDefaultResourceCategoriesSchema
>;

/**
 * The one category every clinic has. Seeded ONLY when the org has none — a
 * clinic that deliberately renamed or removed "Rooms" never gets it back.
 */
export const DEFAULT_RESOURCE_CATEGORIES = [
  { name: 'Rooms', kind: 'room' as const, sortOrder: 0 },
] as const;
