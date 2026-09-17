import { z } from 'zod';

export const stopImpersonatingSchema = z.object({
  /**
   * The raw inbound browser `cookie` header. Both the impersonated session
   * cookie and the signed `admin_session` cookie are required for Better Auth
   * to restore the original admin session.
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
  /**
   * The `admin_session` cookie pair, echoed back by a bearer client that could
   * not store the cookie itself. Without it Better Auth cannot find the admin
   * to restore and refuses the whole request.
   */
  adminSessionCookie: z.string().optional(),
});

export type StopImpersonatingInput = z.infer<typeof stopImpersonatingSchema>;
