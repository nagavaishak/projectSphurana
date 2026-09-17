import { acceptIntroOfferSchema } from '@borradh-workspace/features/onboarding';
import { createZodDto } from 'nestjs-zod';

/**
 * Body for POST /onboarding/accept-offer — optional owner-adjusted intro
 * price + negotiation note. `userId` comes from the authenticated session.
 */
export class AcceptIntroOfferDto extends createZodDto(
  acceptIntroOfferSchema.omit({ userId: true })
) {}
