import { verifyWhatsappLinkSchema } from '@borradh-workspace/features/assistant';
import { createZodDto } from 'nestjs-zod';

/**
 * Verify is normally driven by the inbound WhatsApp webhook (WS-10), but the
 * endpoint is exposed for manual/testing use. Both fields come from the body.
 */
export class VerifyWhatsappLinkDto extends createZodDto(
  verifyWhatsappLinkSchema
) {}
