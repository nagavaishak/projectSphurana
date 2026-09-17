import { patchVideoDraftConfigRequestBase } from '@borradh-workspace/contracts';
import { createZodDto } from 'nestjs-zod';

/**
 * PATCH /videos/:id/draft-config body.
 *
 * Derived from the wire contract rather than restated inline. The handler used
 * to declare this shape as an inline type literal, which meant the
 * `ValidationPipe` validated nothing and the contract's own rules — exactly one
 * of `index` / `targetAssetId` on a clip operation, no empty body — never ran
 * on a real request.
 *
 * `whatsappDelivery` is deliberately absent: it arrives through the
 * `@WhatsappDelivery()` request decorator, so a client cannot address someone
 * else's conversation by putting it in the body.
 */
export class PatchDraftConfigDto extends createZodDto(
  patchVideoDraftConfigRequestBase
) {}
