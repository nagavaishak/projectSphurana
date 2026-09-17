import { z } from 'zod';

export const impersonateUserSchema = z.object({
  userId: z.string(),
  /**
   * The raw inbound browser `cookie` header. Forwarded wholesale because Better
   * Auth needs the admin's session cookie AND writes back a signed
   * `admin_session` cookie that `stopImpersonating` later reads.
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

export type ImpersonateUserInput = z.infer<typeof impersonateUserSchema>;
