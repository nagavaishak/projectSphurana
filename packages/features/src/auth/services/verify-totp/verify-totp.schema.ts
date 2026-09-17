import { z } from 'zod';

export const verifyTotpSchema = z.object({
  code: z.string(),
  trustDevice: z.boolean().optional(),
  /**
   * The raw inbound browser `cookie` header. Forwarded wholesale because two
   * different flows land here and each carries a different cookie:
   *   1. Sign-in 2FA  — a signed `two_factor` cookie, no session yet
   *   2. Settings 2FA — an ordinary session cookie
   */
  cookieHeader: z.string().optional(),
  /**
   * Bearer/cross-origin clients (Capacitor mobile) cannot accept the cross-site
   * `two_factor` cookie, so they pass the raw `name=value` pair back here and it
   * is merged into the forwarded cookie header.
   */
  twoFactorToken: z.string().optional(),
});

export type VerifyTotpInput = z.infer<typeof verifyTotpSchema>;
