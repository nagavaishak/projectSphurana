import { apiEnv } from '@borradh-workspace/env/api';
import {
  type SessionResponse,
  generateIntercomJwt,
} from '@borradh-workspace/features/auth';

/**
 * Response shaping for `GET /auth/session`.
 *
 * Better Auth's session object carries more than the client should see, so the
 * payload is an explicit allow-list: id, expiry, active org, plus two optional
 * extras (`impersonatedBy`, `intercomJwt`) that are omitted rather than sent as
 * null when absent.
 */
export const buildSessionPayload = (data: SessionResponse) => {
  const session = data.session as unknown as {
    id?: string;
    expiresAt?: string | Date;
    activeOrganizationId?: string;
    impersonatedBy?: string;
  };

  // Intercom identity verification, only when a secret is configured.
  const intercomJwt = generateIntercomJwt(
    apiEnv.INTERCOM_IDENTITY_SECRET,
    data.user
  );

  return {
    user: data.user,
    session: {
      id: session.id,
      expiresAt: session.expiresAt,
      activeOrganizationId: session.activeOrganizationId,
      ...(session.impersonatedBy && {
        impersonatedBy: session.impersonatedBy,
      }),
      ...(intercomJwt && { intercomJwt }),
    },
  };
};

/** The anonymous payload — same 200 shape, no user. */
export const ANONYMOUS_SESSION_PAYLOAD = Object.freeze({
  user: null,
  session: null,
});
