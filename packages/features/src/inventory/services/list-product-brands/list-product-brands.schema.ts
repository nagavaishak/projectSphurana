import { z } from 'zod';

export const listProductBrandsSchema = z.object({
  organizationId: z.string().min(1),
});

export type ListProductBrandsInput = z.infer<typeof listProductBrandsSchema>;
