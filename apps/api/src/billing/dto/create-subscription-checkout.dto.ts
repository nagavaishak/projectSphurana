import { createSubscriptionCheckoutSchema } from '@borradh-workspace/features/billing';
import { createZodDto } from 'nestjs-zod';

export class CreateSubscriptionCheckoutDto extends createZodDto(
  createSubscriptionCheckoutSchema.omit({
    organizationId: true,
    customerEmail: true,
  })
) {}
