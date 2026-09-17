import { z } from 'zod';

export const verifyAdminTotpSchema = z.object({
  code: z.string(),
  /**
   * The raw inbound browser `cookie` header, forwarded wholesale: Better Auth's
   * verifyTOTP calls verifyTwoFactor → getSessionFromCtx internally, which
   * needs the full header (not just the session token) to resolve the session.
   */
  cookieHeader: z.string().optional(),
  /**
   * The session token this request authenticated with (bearer OR cookie).
   *
   * Appended to the forwarded header because the browser may hold no session
   * cookie at all wherever COOKIE_DOMAIN is unset — previews, local dev, the
   * E2E runner — leaving Better Auth nothing to resolve.
   */
  sessionToken: z.string().optional(),
});

export type VerifyAdminTotpInput = z.infer<typeof verifyAdminTotpSchema>;
