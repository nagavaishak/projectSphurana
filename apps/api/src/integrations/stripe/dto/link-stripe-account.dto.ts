import { linkStripeAccountRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

export class LinkStripeAccountDto extends createZodDto(
  linkStripeAccountRequestSchema
) {}
