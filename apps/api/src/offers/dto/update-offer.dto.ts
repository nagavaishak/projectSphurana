import { updateOfferRequestBase } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `PUT /offers/:id` body. Validated against the CANONICAL wire contract — `id`
 * is the route param, `organizationId` the session's active org.
 *
 * `.strict()` on the Base rather than `updateOfferRequestSchema` for the same
 * reason as `create-offer.dto.ts`: `createZodDto` needs a `ZodObject`, and the
 * discount-shape refinement still runs inside `updateOffer`.
 */
export class UpdateOfferDto extends createZodDto(
  updateOfferRequestBase.strict()
) {}
