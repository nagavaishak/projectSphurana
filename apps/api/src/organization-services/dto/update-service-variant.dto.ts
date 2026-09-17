import { updateServiceVariantSchema } from '@borradh-workspace/features/organization-services';
import { createZodDto } from 'nestjs-zod';

// id comes from the route param, organizationId from the active-org context.
export class UpdateServiceVariantDto extends createZodDto(
  updateServiceVariantSchema.omit({ id: true, organizationId: true })
) {}
