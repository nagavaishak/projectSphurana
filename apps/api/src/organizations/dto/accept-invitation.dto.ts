import { acceptInvitationRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * Accept-invitation request body. `invitationId` comes from the route param and
 * `userId` from the authenticated session, so neither is in the canonical wire
 * contract — the body only carries `acceptedTerms` (Terms/Privacy agreement
 * from the Review step).
 */
export class AcceptInvitationDto extends createZodDto(
  acceptInvitationRequestSchema
) {}
