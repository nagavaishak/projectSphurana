import { listLeadMembershipsSchema } from '@borradh-workspace/features/memberships';
import { createZodDto } from 'nestjs-zod';

export class ListLeadMembershipsDto extends createZodDto(
  listLeadMembershipsSchema.omit({ organizationId: true })
) {}
