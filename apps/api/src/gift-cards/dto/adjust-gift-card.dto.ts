import { adjustGiftCardRequestSchema } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * `POST /gift-cards/:id/adjust` body. Validated against the CANONICAL wire
 * contract. `amountCents` is signed and non-zero (positive tops up, negative
 * reduces); the card id is a route param and `createdById` comes from session.
 */
export class AdjustGiftCardDto extends createZodDto(
  adjustGiftCardRequestSchema
) {}
