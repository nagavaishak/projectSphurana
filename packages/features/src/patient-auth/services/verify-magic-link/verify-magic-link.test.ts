import {
  _resetPatientAuthMocks,
  bindOrgToMagicToken,
  patientAuth,
  runWithPatientAuthContext,
} from '@borradh-workspace/auth/patient';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { verifyMagicLink } from './verify-magic-link.service.js';

/**
 * A Better Auth magic-link token identifies the PERSON (by email) and not the
 * clinic. Since one `customer_account` spans every clinic someone attends, a
 * bare token replayed with a different `X-Portal-Org` would sign them in
 * somewhere they never proved anything to.
 *
 * So the minting org is HMAC-signed into the token, and this service takes the
 * org from THERE — never from the slug in the request. These tests use the
 * real binding (packages/auth/src/magic-link-binding.ts, re-exported by the
 * boundary mock), so a tampered token is genuinely tampered.
 */
describe('verifyMagicLink', () => {
  const mockDb = createMockDatabase();

  const ORG_A = { id: 'org_a', slug: 'clinic-a' };
  const ORG_B = { id: 'org_b', slug: 'clinic-b' };
  const BA_TOKEN = 'ba-token-xyz';

  const membership = {
    id: 'pa_1',
    leadId: 'lead_1',
    organizationId: ORG_A.id,
    customerAccountId: 'ca_1',
  };

  const verifiedResponse = () =>
    new Response(JSON.stringify({ user: { id: 'ca_1' } }), {
      headers: { 'content-type': 'application/json' },
    });

  beforeEach(() => {
    vi.clearAllMocks();
    // Drain the SHARED Better Auth stubs — see auth-patient mock.
    _resetPatientAuthMocks();
    mockDb._resetMocks();
  });

  it('signs the customer in and pins the session to the token’s org', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.magicLinkVerify).mockResolvedValueOnce(
      verifiedResponse() as never
    );
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(membership);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      email: 'pat@example.com',
      firstName: 'Pat',
      lastName: null,
    });

    const result = await verifyMagicLink(mockDb as never, {
      token: bindOrgToMagicToken(BA_TOKEN, ORG_A.id),
      organizationSlug: ORG_A.slug,
    });

    expect(result.success).toBe(true);
  });

  /**
   * THE replay case. A link legitimately minted for clinic A, presented at
   * clinic B's portal. The org must be read out of the token, so the request's
   * own slug cannot move the sign-in.
   */
  it('ignores the client-supplied slug and uses the org bound into the token', async () => {
    // The org looked up is the TOKEN's org (A), even though the caller said B.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.magicLinkVerify).mockResolvedValueOnce(
      verifiedResponse() as never
    );
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(membership);
    mockDb.query.lead.findFirst.mockResolvedValueOnce({
      id: 'lead_1',
      email: 'pat@example.com',
      firstName: 'Pat',
      lastName: null,
    });

    await verifyMagicLink(mockDb as never, {
      token: bindOrgToMagicToken(BA_TOKEN, ORG_A.id),
      organizationSlug: ORG_B.slug, // ← attacker-controlled, must not matter
    });

    // The org pin handed to Better Auth's session-create context is the
    // TOKEN's org. That value becomes `patient_session.organizationId`, which
    // every later request is checked against — so if the request slug could
    // reach it, the whole cross-clinic defence would be client-controlled.
    expect(runWithPatientAuthContext).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_A.id }),
      expect.any(Function)
    );
  });

  it('REFUSES a token whose bound org has been edited', async () => {
    const tampered = bindOrgToMagicToken(BA_TOKEN, ORG_A.id).replace(
      ORG_A.id,
      ORG_B.id
    );

    const result = await verifyMagicLink(mockDb as never, {
      token: tampered,
      organizationSlug: ORG_B.slug,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
    // Rejected on the signature alone — Better Auth is never consulted, so a
    // tampered token cannot even burn a real one.
    expect(patientAuth.api.magicLinkVerify).not.toHaveBeenCalled();
  });

  it('refuses an unsigned token pasted straight from an email', async () => {
    const result = await verifyMagicLink(mockDb as never, {
      token: BA_TOKEN,
      organizationSlug: ORG_A.slug,
    });

    expect(result.success).toBe(false);
    expect(patientAuth.api.magicLinkVerify).not.toHaveBeenCalled();
  });

  /**
   * Better Auth deletes the verification row before minting a session, so a
   * REPLAYED link throws on the second use. That must surface as the same
   * generic refusal, not a 500.
   */
  it('refuses a replayed (already-consumed) link', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.magicLinkVerify).mockRejectedValueOnce(
      new Error('invalid token')
    );

    const result = await verifyMagicLink(mockDb as never, {
      token: bindOrgToMagicToken(BA_TOKEN, ORG_A.id),
      organizationSlug: ORG_A.slug,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('refuses when the customer has no membership at the token’s org', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.magicLinkVerify).mockResolvedValueOnce(
      verifiedResponse() as never
    );
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(undefined);

    const result = await verifyMagicLink(mockDb as never, {
      token: bindOrgToMagicToken(BA_TOKEN, ORG_A.id),
      organizationSlug: ORG_A.slug,
    });

    expect(result.success).toBe(false);
  });

  it('refuses when the bound org no longer exists', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);

    const result = await verifyMagicLink(mockDb as never, {
      token: bindOrgToMagicToken(BA_TOKEN, 'org_deleted'),
      organizationSlug: ORG_A.slug,
    });

    expect(result.success).toBe(false);
    expect(patientAuth.api.magicLinkVerify).not.toHaveBeenCalled();
  });
});
