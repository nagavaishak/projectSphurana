import { z } from 'zod';

export const updatePackageSchema = z.object({
  id: z.string().min(1, 'Package ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),

  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),

  priceCents: z.number().int().min(0).optional(),

  validityDays: z.number().int().min(1).max(3650).optional().nullable(),

  requiresDeposit: z.boolean().optional(),
  depositAmountCents: z.number().int().min(100).optional().nullable(),

  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type UpdatePackageInput = z.infer<typeof updatePackageSchema>;
