import { apiScopeValues } from '@borradh-workspace/features/api-keys';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const createApiKeyBodySchema = z.object({
  name: z.string().min(1).max(100),
  scopes: z
    .array(z.enum(apiScopeValues as [string, ...string[]]))
    .min(1, 'At least one scope is required'),
  expiresInDays: z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .optional()
    .default(365),
});

export class CreateApiKeyDto extends createZodDto(createApiKeyBodySchema) {}
