import { createPaymentSchema } from '@borradh-workspace/features/payments';
import { createZodDto } from 'nestjs-zod';

export class CreatePaymentDto extends createZodDto(
  createPaymentSchema.omit({ organizationId: true })
) {}
