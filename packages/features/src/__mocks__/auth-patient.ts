import { vi } from 'vitest';

/**
 * Canonical boundary mock for `@borradh-workspace/auth/patient`, aliased in
 * vite.config.ts.
 *
 * WHY IT EXISTS. The real module constructs a Better Auth instance at import
 * time, wired to a drizzle adapter over the real `db`. Importing it from a
 * unit test therefore drags in Better Auth and a live database connection —
 * which is why, before this, NOTHING in patient-auth had a test:
 * `validate-patient-session`, `verify-otp`, `verify-magic-link`,
 * `request-otp` and `mint-magic-link` were entirely uncovered, including the
 * session org-pin that is the only control separating one clinic's patient
 * records from another's.
 *
 * WHAT IS REAL AND WHAT IS FAKE. The `patientAuth.api.*` surface is stubbed —
 * it is Better Auth's job, tested by Better Auth. The magic-link ORG BINDING
 * is deliberately NOT stubbed here: it is our own crypto and the thing that
 * blocks cross-clinic replay, so re-implementing it in a mock would prove
 * nothing. It is tested for real in packages/auth/src/magic-link-binding.test.ts
 * and re-exported below from its own dependency-free module, so tests that
 * merely pass a token through get genuine behaviour.
 *
 * MAINTENANCE RULE (isolate: false). Do not `vi.mock` this module in a test —
 * drive these fns with `vi.mocked()`. See docs/plans/features-test-suite-speedup.md.
 */

export {
  bindOrgToMagicToken,
  unbindOrgFromMagicToken,
} from '@borradh-workspace/auth/magic-link-binding';

/** The signed cookie value BA would have set. */
export const MOCK_SESSION_TOKEN = 'mock-session-token.mock-signature';

/**
 * Stubbed Better Auth API surface.
 *
 * Defaults are the SUCCESS shapes, so a test only overrides the call it is
 * actually about. `getSession` returns null by default — an unauthenticated
 * caller is the safe default for a mock that guards a session boundary.
 */
export const patientAuth = {
  api: {
    sendVerificationOTP: vi.fn().mockResolvedValue(undefined),
    signInEmailOTP: vi.fn().mockResolvedValue({
      headers: new Headers(),
      response: { user: { id: 'mock-customer-account' } },
    }),
    signInMagicLink: vi.fn().mockResolvedValue(undefined),
    magicLinkVerify: vi.fn(),
    getSession: vi.fn().mockResolvedValue(null),
    signOut: vi.fn().mockResolvedValue(undefined),
    createVerificationOTP: vi.fn().mockResolvedValue('123456'),
  },
};

/**
 * Runs `fn` immediately, preserving the real contract that the wrapped call
 * happens inside the context. The ambient values themselves (clinicName, the
 * org pin, the magic-link capture sink) are BA-callback plumbing: a test that
 * needs one drives the corresponding `patientAuth.api.*` stub instead.
 */
export const runWithPatientAuthContext = vi.fn(
  <T>(_ctx: unknown, fn: () => Promise<T>): Promise<T> => fn()
);

/** BA would parse this out of Set-Cookie; tests just need a stable value. */
export const extractPatientSessionToken = vi
  .fn()
  .mockResolvedValue(MOCK_SESSION_TOKEN);

export const patientSessionCookieHeader = vi.fn(
  async (token: string) => `borradh-patient.session_token=${token}`
);

export const getPatientSessionCookieName = vi
  .fn()
  .mockResolvedValue('borradh-patient.session_token');

/** Reset every stub to its default. Call from `beforeEach`. */
export const _resetPatientAuthMocks = (): void => {
  patientAuth.api.sendVerificationOTP.mockReset().mockResolvedValue(undefined);
  patientAuth.api.signInEmailOTP.mockReset().mockResolvedValue({
    headers: new Headers(),
    response: { user: { id: 'mock-customer-account' } },
  });
  patientAuth.api.signInMagicLink.mockReset().mockResolvedValue(undefined);
  patientAuth.api.magicLinkVerify.mockReset();
  patientAuth.api.getSession.mockReset().mockResolvedValue(null);
  patientAuth.api.signOut.mockReset().mockResolvedValue(undefined);
  patientAuth.api.createVerificationOTP.mockReset().mockResolvedValue('123456');
  extractPatientSessionToken.mockReset().mockResolvedValue(MOCK_SESSION_TOKEN);
  runWithPatientAuthContext.mockClear();
};
