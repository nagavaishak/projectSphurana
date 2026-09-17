import { invitePractitionerRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Send / re-send a team member's invitation. The practitioner is named by the
 * route param and their email is read off that row, so neither appears in the
 * body — only the optional permission level, which is absent from the contract
 * when the caller wants an existing invitation's role left alone.
 */
export class InvitePractitionerDto extends createZodDto(
  invitePractitionerRequestSchema
) {}
