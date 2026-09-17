import { trackedResult } from '@borradh-workspace/observability';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GetInvitationByTokenInput,
  getInvitationByTokenSchema,
} from './get-invitation-by-token.schema.js';

/**
 * Public, token-scoped view of an invitation for the Join / Review screens.
 *
 * Only ever exposes the fields required to render those screens and prefill the
 * Review-and-confirm step — nothing else about the invite, the org, or the
 * inviter leaks. `effectiveStatus` collapses an expired-but-pending invite to
 * `expired` so the UI can show a clear message without leaking the raw row.
 */
export interface InvitationByTokenResponse {
  id: string;
  organizationId: string;
  organizationName: string;
  inviterName: string | null;
  email: string;
  role: string | null;
  status: string;
  /** `pending` | `accepted` | `cancelled` | `expired` (derived). */
  effectiveStatus: string;
  isExpired: boolean;
  expiresAt: Date;
  // Prefill fields (from the owner's Profile panel at invite time).
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  phoneCountry: string | null;
  country: string | null;
}

const getInvitationByTokenImpl = async (
  db: DbConnection,
  input: GetInvitationByTokenInput
): Promise<Result<InvitationByTokenResponse>> => {
  const parsed = getInvitationByTokenSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { token } = parsed.data;

  // The token is the opaque invitation id.
  const inv = await db.query.invitation.findFirst({
    where: (i, { eq }) => eq(i.id, token),
    with: {
      organization: true,
      inviter: true,
    },
  });

  if (!inv) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Invitation not found'));
  }

  const isExpired = inv.status === 'pending' && new Date() > inv.expiresAt;
  const effectiveStatus = isExpired ? 'expired' : inv.status;

  return ok({
    id: inv.id,
    organizationId: inv.organizationId,
    organizationName: inv.organization?.name ?? 'Unknown',
    inviterName: inv.inviter?.name ?? null,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    effectiveStatus,
    isExpired,
    expiresAt: inv.expiresAt,
    firstName: inv.firstName ?? null,
    lastName: inv.lastName ?? null,
    phone: inv.phone ?? null,
    phoneCountry: inv.phoneCountry ?? null,
    country: inv.country ?? null,
  });
};

/**
 * Fetch an invitation by its opaque token for the public accept screens.
 *
 * Public / token-scoped: no org auth, scoped only by the opaque token. Returns
 * NOT_FOUND for a missing token; expired/accepted invites are returned with a
 * clear `effectiveStatus` (not an error) so the UI can message appropriately.
 *
 * @example
 * ```ts
 * const result = await getInvitationByToken(db, { token: 'inv-123' });
 * if (result.success) {
 *   console.log(result.data.effectiveStatus); // 'pending' | 'expired' | ...
 * }
 * ```
 */
export const getInvitationByToken = (
  db: DbConnection,
  input: GetInvitationByTokenInput
) =>
  trackedResult(
    'organizations.getInvitationByToken',
    () => getInvitationByTokenImpl(db, input),
    {
      properties: { token: input.token },
      internalErrorsOnly: true,
    }
  );

export type GetInvitationByTokenResult = Awaited<
  ReturnType<typeof getInvitationByToken>
>;
