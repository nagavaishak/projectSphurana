import { updateSupplierSchema } from '@borradh-workspace/features/inventory';
import { createZodDto } from 'nestjs-zod';

export class UpdateSupplierDto extends createZodDto(
  updateSupplierSchema.omit({ id: true, organizationId: true })
) {}
