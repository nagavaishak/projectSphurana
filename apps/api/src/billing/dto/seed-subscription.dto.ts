import { seedSubscriptionRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class SeedSubscriptionDto extends createZodDto(
  seedSubscriptionRequestSchema
) {}
