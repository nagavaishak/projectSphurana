import { z } from 'zod';

export const packageItemInputSchema = z.object({
  serviceId: z.string().min(1, 'Service ID is required'),
  quantity: z.number().int().min(1).max(999).default(1),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const createPackageSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  name: z.string().min(1, 'Package name is required').max(100),
  description: z.string().max(1000).optional().nullable(),
  categoryId: z.string().min(1).optional().nullable(),

  priceCents: z.number().int().min(0),

  validityDays: z.number().int().min(1).max(3650).optional().nullable(),

  requiresDeposit: z.boolean().optional().default(false),
  depositAmountCents: z.number().int().min(100).optional().nullable(),

  sortOrder: z.number().int().min(0).optional().default(0),
  isActive: z.boolean().optional().default(true),

  items: z.array(packageItemInputSchema).min(1, 'At least one item required'),
});

export type CreatePackageInput = z.infer<typeof createPackageSchema>;
export type PackageItemInput = z.infer<typeof packageItemInputSchema>;
