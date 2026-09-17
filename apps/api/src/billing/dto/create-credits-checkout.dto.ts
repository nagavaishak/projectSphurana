import { createCreditsCheckoutSchema } from '@borradh-workspace/features/billing';
import { createZodDto } from 'nestjs-zod';

export class CreateCreditsCheckoutDto extends createZodDto(
  createCreditsCheckoutSchema.omit({ organizationId: true })
) {}
