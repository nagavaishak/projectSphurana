import { listPaymentsSchema } from '@borradh-workspace/features/payments';
import { createZodDto } from 'nestjs-zod';

export class ListPaymentsDto extends createZodDto(
  listPaymentsSchema.omit({ organizationId: true })
) {}
