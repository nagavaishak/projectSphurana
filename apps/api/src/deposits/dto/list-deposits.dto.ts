import { listDepositsSchema } from '@borradh-workspace/features/appointments';
import { createZodDto } from 'nestjs-zod';

export class ListDepositsDto extends createZodDto(
  listDepositsSchema.omit({ organizationId: true })
) {}
