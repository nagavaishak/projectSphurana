import { listAllOrganizationsSchema } from '@borradh-workspace/features/admin-terminal';
import { createZodDto } from 'nestjs-zod';

export class ListAllOrganizationsDto extends createZodDto(
  listAllOrganizationsSchema.omit({})
) {}
