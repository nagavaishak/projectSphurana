import { listSalesSchema } from '@borradh-workspace/features/sales';
import { createZodDto } from 'nestjs-zod';

export class ListSalesDto extends createZodDto(
  listSalesSchema.omit({ organizationId: true })
) {}
