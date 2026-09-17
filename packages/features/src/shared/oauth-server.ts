/**
 * SERVER-ONLY OAuth helpers. Reached as `@borradh-workspace/features/shared/oauth`.
 *
 * WHY THIS FILE EXISTS AS A SEPARATE SUBPATH
 * ------------------------------------------
 * `shared/public.ts` — the barrel behind `@borradh-workspace/features/shared` —
 * is consumed by api-client AND by the frontend, and its own header says it
 * exists to keep server-only code out of browser bundles.
 *
 * These symbols were originally exported from it, with a comment reasoning that
 * apps/api needs them because the guard and interceptor are the enforcement
 * points. That reasoning was correct about apps/api and silent about everyone
 * else: `oauth-state.ts` imports `node:crypto`, so exporting it from the public
 * barrel pulled `createHmac` into the Vite bundle for `apps/app`, where
 * `node:crypto` resolves to `__vite-browser-external` and exports nothing:
 *
 *     "createHmac" is not exported by "__vite-browser-external",
 *       imported by "packages/features/dist/shared/oauth-state.js"
 *
 * Worth noting HOW that got through locally: `pnpm turbo lint typecheck test`
 * was green. Nothing in lint, typecheck or test bundles the frontend — only
 * `turbo build` does, and CI runs it. A server-only import leaking into a
 * browser barrel is invisible to every check short of an actual bundle.
 *
 * `oauth-redirect.ts` is pure and would bundle fine, but it lives here too so
 * that the whole OAuth surface has one server-side home rather than being split
 * across two barrels on a distinction a future caller has to rediscover.
 */

export {
  OAUTH_STATE_MAX_AGE_MS,
  type OAuthStatePayload,
  safeReturnTo,
  signOAuthState,
  verifyOAuthState,
} from './oauth-state.js';
export {
  OAUTH_REDIRECT,
  type OAuthRedirectResult,
  externalRedirect,
  isOAuthRedirect,
  oauthRedirect,
} from './oauth-redirect.js';
