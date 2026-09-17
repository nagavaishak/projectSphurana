/**
 * Stub for @borradh-workspace/auth/server (better-auth).
 *
 * better-auth ships ESM-only `.mjs` and pulls in Redis/session wiring we
 * deliberately keep out of the integration harness. The harness overrides
 * AuthGuard with a fake identity, so the real `auth` object is never invoked —
 * we only need the module to LOAD so transitive imports (auth.guard.ts →
 * common/index.ts → the controllers) resolve.
 */
export const auth = {
  api: {
    // Never called: AuthGuard is overridden in the harness.
    getSession: async () => null,
  },
};

export type Auth = typeof auth;
