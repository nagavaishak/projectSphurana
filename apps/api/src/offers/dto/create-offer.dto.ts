import { createOfferRequestBase } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /offers` body. Validated against the CANONICAL wire contract; the
 * controller injects `organizationId` from the active-org session.
 *
 * `createOfferRequestBase.strict()` rather than `createOfferRequestSchema`
 * because `createZodDto` needs a `ZodObject`, and the exported Schema carries a
 * `.superRefine()` (→ `ZodEffects`). The discount-shape rules are NOT lost:
 * `createOfferSchema` in the features package applies the very same
 * `offerDiscountShapeIssues` inside `createOffer`, so an ill-shaped body is
 * still rejected — as a service-level `VALIDATION_ERROR` rather than a DTO 400.
 * This mirrors what the DTO did before (it used `createOfferBaseSchema`), minus
 * the round-trip through `.omit({ organizationId })` and plus `.strict()`.
 */
export class CreateOfferDto extends createZodDto(
  createOfferRequestBase.strict()
) {}
