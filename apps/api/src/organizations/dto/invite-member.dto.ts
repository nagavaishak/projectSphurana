import { inviteMemberRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/** Invite-member body — the canonical wire contract. `organizationId` and
 * `inviterId` are server-set, so they are absent (and, being `.strict()`,
 * rejected if sent). */
export class InviteMemberDto extends createZodDto(inviteMemberRequestSchema) {}
