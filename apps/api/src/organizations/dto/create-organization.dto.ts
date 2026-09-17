import { createOrganizationSchema } from '@borradh-workspace/features/organizations';
import { createZodDto } from 'nestjs-zod';

export class CreateOrganizationDto extends createZodDto(
  createOrganizationSchema.omit({ createdByUserId: true })
) {}
