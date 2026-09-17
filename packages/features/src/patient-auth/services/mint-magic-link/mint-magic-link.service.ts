import {
  bindOrgToMagicToken,
  patientAuth as patientAuthInstance,
  runWithPatientAuthContext,
} from '@borradh-workspace/auth/patient';
import {
  isUniqueViolation,
  organization,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { ensurePortalMembershipByLead } from '../shared/membership.js';
import {
  type MintMagicLinkInput,
  mintMagicLinkSchema,
} from './mint-magic-link.schema.js';

/**
 * Magic links live 24 hours. MUST match the BA instance's `magicLink.expiresIn`
 * (packages/auth/src/patient.ts) — BA owns the real expiry, this only reports
 * it, so a drift here shows the customer a deadline the token does not honour.
 */
export const MAGIC_LINK_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * The shape callers build a portal URL from — same as the bespoke service it
 * replaces, so `buildPortalAccessUrl(linkTarget, token)` at the call
 * sites is unchanged. `token` is the ORG-BOUND composite (see
 * bindOrgToMagicToken) — opaque to the frontend, verified server-side.
 */
export interface MintMagicLinkData {
  token: string;
  expiresAt: Date;
  organizationSlug: string;
}

const mintMagicLinkImpl = async (
  tx: DbConnection,
  input: MintMagicLinkInput
): Promise<Result<MintMagicLinkData>> => {
  const parsed = mintMagicLinkSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { leadId, organizationId } = parsed.data;

  // Scope the lead to the minting org (prevents clinic A minting a link into
  // clinic B) and pre-create the identity/membership so BA (disableSignUp) can
  // later verify it.
  // Wrapped for the same reason as verify-otp: a concurrent first-ever mint
  // for one lead races on the `customer_account` insert and the loser saw a
  // 23505 escape as INTERNAL_ERROR. Retry once — the winner created the row.
  let membership: Awaited<ReturnType<typeof ensurePortalMembershipByLead>>;
  try {
    membership = await ensurePortalMembershipByLead(tx, organizationId, leadId);
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    membership = await ensurePortalMembershipByLead(tx, organizationId, leadId);
  }
  if (!membership) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Patient not found'));
  }

  const org = await tx.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });
  if (!org?.slug) {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to mint link')
    );
  }

  try {
    // Capture BA's raw magic-link token instead of emailing it — the caller
    // wraps it into our own template. The capture sink is read by the
    // instance's sendMagicLink callback via ambient context.
    let captured: string | null = null;
    await runWithPatientAuthContext(
      {
        captureMagicLink: ({ token }) => {
          captured = token;
        },
      },
      () =>
        patientAuthInstance.api.signInMagicLink({
          body: { email: membership.email },
          headers: new Headers(), // signInMagicLink requires headers
        })
    );

    if (!captured) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to mint link')
      );
    }

    return ok({
      token: bindOrgToMagicToken(captured, organizationId),
      expiresAt: new Date(Date.now() + MAGIC_LINK_TTL_MS),
      organizationSlug: org.slug,
    });
  } catch (error) {
    logError('patientAuth.mintMagicLink', error, {
      feature: 'patient-auth',
      extra: { leadId, organizationId },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to mint link')
    );
  }
};

/** Mint a direct sign-in (magic) link for a lead. */
export const mintMagicLink = (db: DbConnection, input: MintMagicLinkInput) =>
  trackedResult(
    'patientAuth.mintMagicLink',
    () => withSystemScope((tx) => mintMagicLinkImpl(tx, input), { db }),
    {
      // `leadId` and the actor belong on the SUCCESS path, not just the error
      // one. A mint that works is the event worth being able to reconstruct:
      // it is the moment someone gained portal access to a patient's record,
      // and until now only failures were attributable.
      properties: {
        organizationId: input.organizationId,
        leadId: input.leadId,
        actingUserId: input.actingUserId ?? 'system',
      },
    }
  );

export type MintMagicLinkResult = Awaited<ReturnType<typeof mintMagicLink>>;
