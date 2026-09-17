import {
  patientAuth as patientAuthInstance,
  runWithPatientAuthContext,
  unbindOrgFromMagicToken,
} from '@borradh-workspace/auth/patient';
import {
  lead,
  organization,
  patientAuth,
  withSystemScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
} from '../../../shared/index.js';
import {
  type PatientSignInData,
  finalizePatientSignIn,
} from '../shared/sign-in.js';
import {
  type VerifyMagicLinkInput,
  verifyMagicLinkSchema,
} from './verify-magic-link.schema.js';

export type { PatientSignInData };

const invalid = (): Result<PatientSignInData> =>
  err(new FeatureError(ErrorCodes.UNAUTHORIZED, 'Invalid or expired link'));

const verifyMagicLinkImpl = async (
  tx: DbConnection,
  input: VerifyMagicLinkInput
): Promise<Result<PatientSignInData>> => {
  const parsed = verifyMagicLinkSchema.safeParse(input);
  if (!parsed.success) return invalid();

  // The clinic is bound INTO the token at mint time (HMAC), NOT taken from the
  // client-supplied slug — so a link minted for clinic A can't be replayed
  // against clinic B where the same person is also a patient (Blocker 1 for
  // links). Tampering with the embedded org breaks the signature → generic
  // failure. The `organizationSlug` from the request is ignored for the pin.
  const unbound = unbindOrgFromMagicToken(parsed.data.token);
  if (!unbound) return invalid();
  const { baToken, organizationId } = unbound;

  const org = await tx.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });
  if (!org) return invalid();

  try {
    // `asResponse` → a Response we can read BOTH the Set-Cookie (the signed
    // session credential) AND the JSON body from. No callbackURL → BA returns
    // { token, user } in the body instead of redirecting, and still sets the
    // session cookie. The plugin types magicLinkVerify as a plain
    // `{ token, user }` function and doesn't surface the asResponse overload
    // (which the runtime honours), so cast to its true runtime signature.
    const verifyMagicLinkEndpoint = patientAuthInstance.api
      .magicLinkVerify as unknown as (opts: {
      query: { token: string };
      headers: Headers;
      asResponse: true;
    }) => Promise<Response>;

    const httpResponse = await runWithPatientAuthContext(
      { organizationId },
      () =>
        // `headers` is required by the endpoint (requireHeaders) even server-side.
        verifyMagicLinkEndpoint({
          query: { token: baToken },
          headers: new Headers(),
          asResponse: true,
        })
    );
    const headers = httpResponse.headers;
    const body = (await httpResponse.json()) as { user: { id: string } };
    const customerAccountId = body.user.id;

    // The mint ensured a membership; resolve it (+ the lead) for the greeting.
    const membership = await tx.query.patientAuth.findFirst({
      where: and(
        eq(patientAuth.customerAccountId, customerAccountId),
        eq(patientAuth.organizationId, organizationId)
      ),
    });
    if (!membership) return invalid();

    const leadRow = await tx.query.lead.findFirst({
      where: eq(lead.id, membership.leadId),
    });

    return finalizePatientSignIn(tx, {
      headers,
      customerAccountId,
      leadId: membership.leadId,
      email: leadRow?.email ?? '',
      firstName: leadRow?.firstName ?? null,
      lastName: leadRow?.lastName ?? null,
      method: 'magic-link',
    });
  } catch {
    // BA verify throws (or throws a redirect) on invalid / expired / used.
    return invalid();
  }
};

/** Exchange a clinic-shared magic link for a session. */
export const verifyMagicLink = (
  db: DbConnection,
  input: VerifyMagicLinkInput
) =>
  trackedResult(
    'patientAuth.verifyMagicLink',
    () => withSystemScope((tx) => verifyMagicLinkImpl(tx, input), { db }),
    { internalErrorsOnly: true, trackSuccess: false }
  );

export type VerifyMagicLinkResult = Awaited<ReturnType<typeof verifyMagicLink>>;
