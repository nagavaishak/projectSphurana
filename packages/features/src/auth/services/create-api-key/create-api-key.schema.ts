import { z } from 'zod';

export const createApiKeySchema = z.object({
  /** User ID who owns this API key */
  userId: z.string().min(1, 'User ID is required'),
  /** Organization ID to associate with the key */
  organizationId: z.string().min(1, 'Organization ID is required'),
  /** Organization name (stored in metadata) */
  organizationName: z.string().min(1, 'Organization name is required'),
  /** Organization slug (stored in metadata) */
  organizationSlug: z.string().min(1, 'Organization slug is required'),
  /** Name for the API key */
  name: z.string().min(1).max(100).optional(),
  /** Expiration time in days (default: 365) */
  expiresInDays: z.number().int().min(1).max(365).optional().default(365),
  /** API scopes granted to this key (e.g., ['leads:read', 'leads:write']) */
  scopes: z
    .array(z.string())
    .min(1, 'At least one scope is required')
    .optional(),
  /** Rate limit max requests per hour (set by controller based on plan) */
  rateLimitMax: z.number().int().min(1).optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
