import { defineCoverage } from '../coverage.types.js';

/**
 * AUTH — 16 endpoints, 0 tools, and it should stay that way.
 *
 * Claire runs INSIDE an authenticated session. Every route here either
 * establishes that session, changes the credentials behind it, or ends it —
 * which puts all of them on the wrong side of the boundary she operates
 * within. A tool that can change the password of the account it is acting for
 * is not a capability, it is a privilege escalation with a friendly name.
 *
 * Two further reasons recur below and are worth stating once:
 *
 *   - SEVERAL ARE BROWSER-BOUND. The Google routes are 302s carrying a signed
 *     state cookie; the verify-email GET is the target of a link in an email.
 *     They are not callable server-side in any meaningful sense.
 *   - THE OUT-OF-BAND CHANNEL IS THE POINT. Forgot-password, resend-
 *     verification and change-email all work by sending something to an inbox
 *     the human controls. That inbox is the security boundary; an agent that
 *     can trigger those mails at will is a spam vector even when it cannot
 *     read them.
 */
export const authCoverage = defineCoverage('auth', {
  // ---- session establishment --------------------------------------------
  'POST /auth/sign-in': {
    notExposed:
      'Exchanges an email and password for a session. Claire only ever runs inside a session that already exists; a tool that mints one would need to be handed a password, and nothing should ever put a password in a model’s context.',
  },
  'POST /auth/sign-up': {
    notExposed:
      'Creates a user and an organization from scratch. Signup is where currency, country and the Stripe customer are established, and it is the moment a human accepts terms — not a step in a conversation.',
  },
  'POST /auth/sign-out': {
    notExposed:
      'Revokes the current session. Claire ending the session she is running inside would terminate the conversation mid-turn, and there is no owner intent this serves.',
  },
  'GET /auth/session': {
    notExposed:
      'Returns the raw session and its bearer-equivalent context. Everything Claire legitimately needs from it — the org, its settings, its connections — she gets from context_getOrganizationContext, without the credential material.',
  },
  'GET /auth/google': {
    notExposed:
      'Redirects the browser into Google sign-in with a signed state cookie. There is no response body, only a 302 that a model cannot follow and a cookie it cannot hold.',
  },
  'GET /auth/google/sign-up': {
    notExposed:
      'The registration variant of the same Google redirect, which additionally provisions an org on return. Browser-bound handshake, and account creation besides.',
  },
  'POST /auth/apple/native': {
    notExposed:
      'Verifies an Apple identity token minted by the iOS runtime on the device. Only the native app can obtain that token, so the route has exactly one legitimate caller.',
  },

  // ---- credential changes ------------------------------------------------
  'POST /auth/change-password': {
    notExposed:
      'Changes the account password. If Claire could do this, a prompt injection in an inbound customer message could lock an owner out of their own business — the single sharpest escalation on the surface.',
  },
  'POST /auth/change-email': {
    notExposed:
      'Moves the account to a new address, which moves every future reset and verification mail with it. Redirecting the recovery channel is account takeover in slow motion.',
  },
  'POST /auth/forgot-password': {
    notExposed:
      'Sends a reset link to an arbitrary address. Even without the ability to read the inbox, an agent able to fire this on request is a mail-bombing tool aimed at real people.',
  },
  'POST /auth/reset-password': {
    notExposed:
      'Consumes a single-use token that only ever arrives in an email. Claire has no inbox, so she can never hold a valid token — and should not be the thing that spends one if she somehow did.',
  },
  'POST /auth/resend-verification': {
    notExposed:
      'Re-sends the verification mail. Repeatable, unauthenticated-adjacent and outbound — the classic shape of an endpoint that becomes a spam relay the moment something automated can call it.',
  },

  // ---- verification and 2FA ----------------------------------------------
  'GET /auth/verify-email': {
    notExposed:
      'The target of the link in the verification email; it consumes the token and redirects the browser onward. Nothing about it is addressable without the mail.',
  },
  'POST /auth/verify-email': {
    notExposed:
      'API form of the same single-use token exchange, used by the mobile app. Verification is the only proof we hold that an address belongs to the person claiming it.',
  },
  'POST /auth/two-factor/enable': {
    notExposed:
      'Begins TOTP enrolment and returns the shared secret. That secret is a second factor precisely because it lives on a device the owner holds; passing it through a model defeats the mechanism.',
  },
  'POST /auth/two-factor/verify-totp': {
    notExposed:
      'Verifies a six-digit code from the owner’s authenticator app. The whole point is that only the person holding the device can answer, and Claire is not that person.',
  },
});
