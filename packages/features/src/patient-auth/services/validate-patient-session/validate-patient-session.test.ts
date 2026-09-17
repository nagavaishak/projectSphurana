import {
  _resetPatientAuthMocks,
  patientAuth,
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
import { validatePatientSession } from './validate-patient-session.service.js';

/**
 * The session ORG-PIN is the single control separating a customer's session at
 * one clinic from that same customer's records at another.
 *
 * A `customer_account` is universal by design — one email, one identity, any
 * number of clinics. So the session, not the account, has to carry which
 * clinic it was minted for, and every authenticated request has to re-check
 * it. That check is one `if` in this service. It had no test.
 *
 * Every failure below must be the SAME generic UNAUTHORIZED: a distinguishable
 * error would let a stolen cookie probe which clinics a person attends, which
 * is precisely the fact the portal exists to protect.
 */
describe('validatePatientSession', () => {
  const mockDb = createMockDatabase();

  const ORG_A = { id: 'org_a', slug: 'clinic-a' };
  const ORG_B = { id: 'org_b', slug: 'clinic-b' };

  const input = { sessionToken: 'signed.token', organizationSlug: 'clinic-a' };

  /** A live BA session pinned to `organizationId`. */
  const sessionPinnedTo = (organizationId: string | null) => ({
    session: {
      id: 'sess_1',
      organizationId,
      expiresAt: new Date('2026-12-01T00:00:00Z'),
    },
    user: { id: 'ca_1' },
  });

  const membership = {
    id: 'pa_1',
    leadId: 'lead_1',
    organizationId: 'org_a',
    customerAccountId: 'ca_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Drain the SHARED Better Auth stubs. Under `isolate: false` a queued
    // `...Once` value outlives the file that set it and is consumed by
    // whichever test calls the stub next.
    _resetPatientAuthMocks();
    mockDb._resetMocks();
  });

  it('resolves the patient when the pin matches the requested clinic', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
      sessionPinnedTo(ORG_A.id) as never
    );
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(membership);

    const result = await validatePatientSession(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.leadId).toBe('lead_1');
      expect(result.data.organizationId).toBe('org_a');
    }
  });

  /**
   * THE test. A session minted at clinic B, presented with
   * `X-Portal-Org: clinic-a`. The customer is real, the session is live, the
   * token is genuine — and it must still be refused, because they never
   * proved anything to clinic A.
   */
  it('REFUSES a live session whose pin is a different clinic', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
      sessionPinnedTo(ORG_B.id) as never
    );

    const result = await validatePatientSession(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
    // Refused on the pin alone — it must never reach the membership lookup,
    // because a membership at clinic A may well exist for this person.
    expect(mockDb.query.patientAuth.findFirst).not.toHaveBeenCalled();
  });

  /**
   * Fail CLOSED on an unpinned session. A row written before the pin existed,
   * or one created outside the AsyncLocalStorage context, has
   * `organizationId: null` — which must match NO clinic rather than every one.
   */
  it('refuses a session with no pin at all', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
      sessionPinnedTo(null) as never
    );

    const result = await validatePatientSession(mockDb as never, input);

    expect(result.success).toBe(false);
    expect(mockDb.query.patientAuth.findFirst).not.toHaveBeenCalled();
  });

  /**
   * The pin can match while the membership is gone — the clinic deleted the
   * lead, or the person was never a patient there. Both must refuse.
   */
  it('refuses when the pin matches but no membership exists at that clinic', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
      sessionPinnedTo(ORG_A.id) as never
    );
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(undefined);

    const result = await validatePatientSession(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('refuses when Better Auth does not recognise the token', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
    vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(null as never);

    const result = await validatePatientSession(mockDb as never, input);

    expect(result.success).toBe(false);
  });

  it('refuses an unknown clinic slug without consulting the session', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);

    const result = await validatePatientSession(mockDb as never, input);

    expect(result.success).toBe(false);
    expect(patientAuth.api.getSession).not.toHaveBeenCalled();
  });

  /**
   * A distinguishable error is an oracle: "wrong clinic" vs "no membership"
   * vs "bad token" would let a stolen cookie enumerate which clinics someone
   * attends. They must be indistinguishable to the caller.
   */
  it('returns an identical error for every distinct failure', async () => {
    const messages = new Set<string>();
    const codes = new Set<string>();

    const failures: Array<() => void> = [
      () => {
        mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
        vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
          sessionPinnedTo(ORG_B.id) as never
        );
      },
      () => {
        mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
        vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
          null as never
        );
      },
      () => {
        mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG_A);
        vi.mocked(patientAuth.api.getSession).mockResolvedValueOnce(
          sessionPinnedTo(ORG_A.id) as never
        );
        mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(undefined);
      },
    ];

    for (const seed of failures) {
      mockDb._resetMocks();
      seed();
      const result = await validatePatientSession(mockDb as never, input);
      expect(result.success).toBe(false);
      if (!result.success) {
        messages.add(result.error.message);
        codes.add(result.error.code);
      }
    }

    expect(messages.size).toBe(1);
    expect(codes.size).toBe(1);
  });
});
