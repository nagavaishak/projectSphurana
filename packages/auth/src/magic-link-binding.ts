import { createHmac, timingSafeEqual } from 'node:crypto';
import { authEnv } from '@borradh-workspace/env/auth';

// ── Magic-link org binding (Blocker 1 for links) ────────────────────────────
//
// A BA magic-link token is bound only to the EMAIL (person), losing the org.
// Staff mint a link for clinic A; if the same person is a patient at clinic B,
// a bare BA token could be replayed with X-Portal-Org: B to read B's data
// WITHOUT proving email ownership. So we bind the MINT org into the token with
// an HMAC (over BETTER_AUTH_SECRET). The composite token is opaque to the
// frontend (it just forwards `?token=`), and the org used to pin the session is
// taken from the token, never from the client header — tampering with the org
// breaks the signature. OTP sign-in needs no binding: it proves email
// ownership, so pinning to the requested clinic is safe.
//
// Kept in its OWN module, separate from the Better Auth instance in
// patient.ts, so it can be tested as what it is — pure crypto — without
// constructing an auth instance or a database connection. patient.ts
// re-exports both functions, so every existing import site is unchanged.

const MAGIC_TOKEN_SEP = '.';

/**
 * Domain-separation label, mixed into the HMAC key.
 *
 * `BETTER_AUTH_SECRET` is also BA's cookie-signing key, so using it raw here
 * meant one key serving two protocols. The message shapes differ enough that a
 * practical cross-protocol collision was implausible, but a derived subkey
 * removes the question rather than reasoning about it — and it costs one hash.
 *
 * The version suffix means a future change to the token layout can rotate the
 * label instead of silently reinterpreting old tokens.
 */
const BINDING_KEY_LABEL = 'borradh:patient-magic-link-org-bind:v1';

/** HKDF-ish: one extraction step, which is all a fixed-label subkey needs. */
const bindingKey = (): Buffer =>
  createHmac('sha256', authEnv.BETTER_AUTH_SECRET)
    .update(BINDING_KEY_LABEL)
    .digest();

/**
 * Length-prefix each field before signing.
 *
 * Plain concatenation (`a + ':' + b`) is ambiguous: `"x:y" + ":" + "z"` and
 * `"x" + ":" + "y:z"` produce an identical message, so one signature could
 * vouch for two different (token, org) pairs. Neither BA tokens nor org ids
 * contain a colon today, so it was not exploitable — but that is a property
 * of the inputs, not of the construction, and inputs change.
 */
const signingMessage = (baToken: string, organizationId: string): string =>
  `${baToken.length}:${baToken}|${organizationId.length}:${organizationId}`;

export const bindOrgToMagicToken = (
  baToken: string,
  organizationId: string
): string => {
  const sig = createHmac('sha256', bindingKey())
    .update(signingMessage(baToken, organizationId))
    .digest('hex');
  return [baToken, organizationId, sig].join(MAGIC_TOKEN_SEP);
};

export const unbindOrgFromMagicToken = (
  composite: string
): { baToken: string; organizationId: string } | null => {
  const parts = composite.split(MAGIC_TOKEN_SEP);
  if (parts.length < 3) return null;
  const sig = parts.pop() as string;
  const organizationId = parts.pop() as string;
  const baToken = parts.join(MAGIC_TOKEN_SEP); // tolerate a separator in the token
  const expected = createHmac('sha256', bindingKey())
    .update(signingMessage(baToken, organizationId))
    .digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { baToken, organizationId };
};
