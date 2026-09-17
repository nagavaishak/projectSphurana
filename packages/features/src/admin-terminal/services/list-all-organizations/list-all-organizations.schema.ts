import { z } from 'zod';

export const listAllOrganizationsSchema = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListAllOrganizationsInput = z.infer<
  typeof listAllOrganizationsSchema
>;
