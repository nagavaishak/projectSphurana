import { createTeamMemberRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Composite "Add team member" create. `organizationId` and `inviterId` are
 * server-set (from the active org + current user), so they are absent from the
 * canonical wire contract this DTO validates against.
 */
export class CreateTeamMemberDto extends createZodDto(
  createTeamMemberRequestSchema
) {}
