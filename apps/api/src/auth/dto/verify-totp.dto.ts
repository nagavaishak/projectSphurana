import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const verifyTotpSchema = z.object({
  code: z.string().length(6, 'TOTP code must be 6 digits'),
  trustDevice: z.boolean().optional(),
  // Bearer/cross-origin clients (Capacitor, native mobile) can't receive
  // Better Auth's signed two_factor cookie cross-origin. They get the raw
  // `name=value` pair from the sign-in response and pass it back here.
  twoFactorToken: z.string().optional(),
});

export class VerifyTotpDto extends createZodDto(verifyTotpSchema) {}
