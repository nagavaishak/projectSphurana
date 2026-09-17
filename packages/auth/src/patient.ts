import { AsyncLocalStorage } from 'node:async_hooks';
import {
  customerAccount,
  db,
  patientBaAccount,
  patientSession,
  patientVerification,
} from '@borradh-workspace/database';
import { PatientOtpEmail, sendEmail } from '@borradh-workspace/email';
import { authEnv } from '@borradh-workspace/env/auth';
import { logError } from '@borradh-workspace/observability';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { emailOTP, magicLink } from 'better-auth/plugins';

/**
 * Patient portal auth — a SECOND, fully isolated Better Auth instance
 * (ENG-647). Nothing here is shared with the staff instance
 * (`./server.ts`): its own cookie prefix, its own tables, its own plugins.
 * The staff instance is deliberately not imported or refactored, so a change
 * here can never regress staff login.
 *
 * Headless, house pattern: this instance is NEVER mounted as an HTTP handler.
 * The NestJS patient controllers call `patientAuth.api.*` server-side (mirroring
 * `apps/api/src/auth/auth.controller.ts`), extract the Set-Cookie value with
 * `returnHeaders: true`, and place it in the `borradh_patient_session` cookie.
 * The `PatientAuthGuard` validates via `patientAuth.api.getSession`.
 *
 * Identity model: PASSWORDLESS (emailOTP + magicLink), `disableSignUp: true`.
 * The domain layer (`packages/features/src/patient-auth`) pre-creates the
 * `customer_account` (BA user) + `patient_auth` membership for an ELIGIBLE
 * lead BEFORE calling this instance, so BA never mints an identity from an
 * unknown email. BA owns only `patient_session` + `patient_verification`.
 */

/**
 * Per-call context threaded into BA's callbacks via AsyncLocalStorage — the
 * only reliable way to pass the acting clinic (for the OTP email + the session
 * org-pin) and the magic-link capture sink into plugin callbacks that BA
 * invokes with a fixed signature. Set by the patient-auth feature services
 * that wrap each `patientAuth.api.*` call.
 */
export interface PatientAuthCallContext {
  /** Clinic display name for the OTP email subject/body. */
  clinicName?: string;
  /** The org a newly-created session is pinned to (see the create hook). */
  organizationId?: string;
  /**
   * Capture sink for a minted magic-link token. When set, `sendMagicLink`
   * hands the raw token here INSTEAD of emailing — the caller wraps it into the
   * org-bound portal URL. When unset, a magic-link mint is a bug (we never
   * email bare links) and throws.
   */
  captureMagicLink?: (data: { token: string; url: string }) => void;
}

const patientAuthContext = new AsyncLocalStorage<PatientAuthCallContext>();

/** Run `fn` with the given BA-callback context bound (AsyncLocalStorage). */
export const runWithPatientAuthContext = <T>(
  ctx: PatientAuthCallContext,
  fn: () => Promise<T>
): Promise<T> => patientAuthContext.run(ctx, fn);

// Config parity with the bespoke system it replaces.
const OTP_LENGTH = 6;
const OTP_EXPIRES_IN_SECONDS = 10 * 60; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
/**
 * Magic-link TTL: 24 hours.
 *
 * Better Auth's own default is 5 minutes. This was 7 days — three orders of
 * magnitude above it — which turned a link sitting in an inbox into a
 * week-long bearer credential for a medical-adjacent record. 24h covers the
 * realistic click window for the emails that carry one (reminders go out 24h
 * and 1h ahead; consent requests are acted on the same day) without leaving
 * the credential live long after the appointment is over.
 *
 * The BOOKING CONFIRMATION deliberately carries no magic link: it is sent at
 * booking time, sometimes weeks ahead, so no sane link TTL fits it. It gets
 * the appointment-scoped manage token instead — a capability ("manage this
 * booking"), not an identity. See submit-general-booking.
 */
const MAGIC_LINK_EXPIRES_IN_SECONDS = 24 * 60 * 60; // 24 hours
/**
 * Ceiling on session length. An OTP sign-in gets all of it; a magic-link
 * sign-in is shortened to 7 days after the fact, in finalizePatientSignIn,
 * because the credential it was redeemed from proves much less.
 */
const SESSION_EXPIRES_IN_SECONDS = 30 * 24 * 60 * 60; // 30 days (cookie parity)

export const patientAuth = betterAuth({
  appName: 'Borradh Patient Portal',
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Model names → our dedicated tables. The drizzle table PROPERTY keys must
    // equal BA's field names (id, userId, emailVerified, …); column names are
    // free. See packages/database/src/schema/patient-auth.ts.
    schema: {
      user: customerAccount,
      session: patientSession,
      account: patientBaAccount,
      verification: patientVerification,
    },
  }),
  baseURL: authEnv.BETTER_AUTH_URL,
  // Never mounted; set distinct from staff `/better-auth` purely so the two
  // instances can't be confused.
  basePath: '/patient-better-auth',
  secret: authEnv.BETTER_AUTH_SECRET,
  advanced: {
    // Distinct cookie name from staff — a clinic owner may be signed into the
    // dashboard AND their own clinic's portal in one browser.
    cookiePrefix: 'borradh-patient',
    // Cookie attributes DUPLICATED from server.ts (not shared) — the two
    // instances may need to diverge. Largely cosmetic here since our controller
    // re-sets the cookie itself, but kept consistent.
    crossSubDomainCookies: authEnv.COOKIE_DOMAIN
      ? { enabled: true, domain: authEnv.COOKIE_DOMAIN }
      : undefined,
    defaultCookieAttributes: {
      sameSite: authEnv.COOKIE_DOMAIN ? 'lax' : 'none',
      secure: true,
      httpOnly: true,
    },
  },
  session: {
    expiresIn: SESSION_EXPIRES_IN_SECONDS,
    // The org-pin (Blocker 1). `input: false` → a client can never supply it;
    // it is stamped server-side by the create hook below.
    additionalFields: {
      organizationId: { type: 'string', required: false, input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Stamp the org-pin from the ambient call context. Runs inside the
        // `patientAuth.api.*` call, which the feature services wrap in
        // `runWithPatientAuthContext({ organizationId })`, so AsyncLocalStorage
        // carries it here. Returning `{ data }` MERGES over the row (verified
        // against better-auth 1.4.7 db/with-hooks.mjs).
        before: async (_session) => {
          const orgId = patientAuthContext.getStore()?.organizationId;
          if (orgId) return { data: { organizationId: orgId } };
          return;
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: OTP_LENGTH,
      expiresIn: OTP_EXPIRES_IN_SECONDS,
      allowedAttempts: OTP_MAX_ATTEMPTS,
      // Hash codes at rest (parity with the bespoke SHA-256 store). E2E reads
      // the raw code via the server-only createVerificationOTP endpoint.
      storeOTP: 'hashed',
      // We pre-create the identity for eligible leads; BA must never mint one.
      disableSignUp: true,
      async sendVerificationOTP({ email, otp, type }) {
        // We only ever request sign-in OTPs.
        if (type !== 'sign-in') return;
        const clinicName =
          patientAuthContext.getStore()?.clinicName ?? 'your clinic';

        // NOT awaited — deliberately. BA awaits this callback, and requestOtp
        // awaits BA, so awaiting the mail provider here put a full Resend
        // round trip on the response path for a KNOWN email and nothing at all
        // on the path for an unknown one. That is an account-existence oracle:
        // ~40ms says "not a patient here", ~400ms says "yes" — and for a
        // medical portal, whether someone is a patient at a named clinic is
        // the sensitive fact. The org slug is public and sits in the URL.
        //
        // Worse than the timing, awaiting also leaked through ERRORS: a mail
        // provider outage turned the known-email path into a 500 while the
        // unknown-email path kept returning the neutral 202. That is a far
        // louder signal than a few hundred milliseconds.
        //
        // Both branches now return as soon as the code is minted. A failed
        // send is logged and the customer simply does not receive a code —
        // the same thing they experience today when Resend drops a message,
        // and they retry.
        void sendEmail({
          to: email,
          subject: `Your ${clinicName} sign-in code`,
          template: PatientOtpEmail,
          props: { clinicName, code: otp },
        }).catch((error) => {
          logError('patientAuth.sendVerificationOTP', error, {
            feature: 'patient-auth',
            // No email address and no code: this log line would otherwise be
            // the record of who is a patient where, plus a live credential.
          });
        });
      },
    }),
    magicLink({
      expiresIn: MAGIC_LINK_EXPIRES_IN_SECONDS,
      disableSignUp: true,
      storeToken: 'hashed',
      async sendMagicLink({ email, url, token }) {
        const capture = patientAuthContext.getStore()?.captureMagicLink;
        if (!capture) {
          // Reached only if signInMagicLink is called outside a mint wrapper —
          // we never email bare links (they ride inside our own templates).
          throw new Error(
            `patient magic link generated for ${email} outside a capture context`
          );
        }
        capture({ token, url });
      },
    }),
  ],
});

/**
 * The instance's session-token cookie name (`[__Secure-]borradh-patient.session_token`).
 * Resolved from `$context` — never hand-constructed, because the `__Secure-`
 * prefix depends on baseURL/NODE_ENV. Cached after first resolution.
 */
let cachedCookieName: string | null = null;
export const getPatientSessionCookieName = async (): Promise<string> => {
  if (cachedCookieName) return cachedCookieName;
  const ctx = await patientAuth.$context;
  cachedCookieName = ctx.authCookies.sessionToken.name;
  return cachedCookieName;
};

/**
 * Extract the BA session-token cookie VALUE from a `returnHeaders: true`
 * response's Set-Cookie. This is the SIGNED credential (`<token>.<hmac>`) —
 * the only thing `getSession` will validate; the plaintext `token` BA returns
 * in the response body will NOT validate.
 *
 * Returned URL-DECODED (RAW) — the canonical form we transport in our own
 * cookie/bearer. BA percent-encodes the signature (`/`, `+`, `=`) in
 * Set-Cookie; decoding here means the value round-trips identically whether it
 * later arrives via our httpOnly cookie (Express re-encodes → cookie-parser
 * decodes → RAW) or the bearer header (RAW), so both transports converge.
 */
export const extractPatientSessionToken = async (
  headers: Headers
): Promise<string | null> => {
  const name = await getPatientSessionCookieName();
  const cookieStrings =
    typeof headers.getSetCookie === 'function'
      ? headers.getSetCookie()
      : headers.get('set-cookie')
        ? [headers.get('set-cookie') as string]
        : [];
  for (const raw of cookieStrings) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) {
      return decodeURIComponent(pair.slice(eq + 1).trim());
    }
  }
  return null;
};

/**
 * Build the `Cookie` header value that presents a patient session token to
 * `patientAuth.api.getSession({ headers })`. The token is percent-ENCODED — BA
 * decodes the cookie value before validating the signature, exactly as it
 * would for a browser-sent cookie, so a RAW token must be re-encoded here.
 */
export const patientSessionCookieHeader = async (
  token: string
): Promise<string> =>
  `${await getPatientSessionCookieName()}=${encodeURIComponent(token)}`;

// ── Magic-link org binding ──────────────────────────────────────────────────
//
// Lives in ./magic-link-binding.ts — pure crypto, no Better Auth instance and
// no database, so it is testable on its own. Re-exported here because every
// caller imports it from '@borradh-workspace/auth/patient'.
export {
  bindOrgToMagicToken,
  unbindOrgFromMagicToken,
} from './magic-link-binding.js';
