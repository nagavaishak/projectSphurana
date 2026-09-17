import { importExternalTeamMembersSchema } from '@borradh-workspace/features/integrations';
import { createZodDto } from 'nestjs-zod';

export class ImportTeamMembersDto extends createZodDto(
  importExternalTeamMembersSchema.omit({
    organizationId: true,
    bookingAccountId: true,
  })
) {}
