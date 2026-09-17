/**
 * Extra per-worker env for the REAL-AUTH integration suite only.
 *
 * Runs after `setup-after-env.ts` (both are `setupFiles`, applied in order).
 *
 * Pins BETTER_AUTH_URL to an https origin. Better Auth derives
 * `useSecureCookies` from whether baseURL starts with https, and the http path
 * makes impersonation fail here — but no environment we ship is http:
 * production, staging, per-PR previews and the local cloudflared tunnel are
 * all https. `.env.integration` carries http://localhost:3000, which is
 * harmless for the ~70 specs that stub auth entirely and wrong for the few
 * that do not.
 *
 * The host is never dialled; only its scheme is read.
 */
process.env.BETTER_AUTH_URL = 'https://api.auth-int-test.local';
