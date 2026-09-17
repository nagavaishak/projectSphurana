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
import { requestOtp } from './request-otp.service.js';

/**
 * Step 1 of passwordless sign-in, and the endpoint most able to answer a
 * question it must not: "is this person a patient at this clinic?"
 *
 * The org slug is public — it is in the portal URL — so anyone can ask about
 * any email. The response must be identical whether the email belongs to a
 * patient here, to a patient somewhere else, or to nobody: same shape, same
 * status, and no timing or error-path difference to read it off.
 */
describe('requestOtp', () => {
  const mockDb = createMockDatabase();

  const ORG = { id: 'org_a', slug: 'clinic-a', name: 'Clinic A' };
  const input = { organizationSlug: 'clinic-a', email: 'pat@example.com' };

  const lead = {
    id: 'lead_1',
    organizationId: ORG.id,
    email: 'pat@example.com',
    firstName: 'Pat',
    lastName: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Drain the SHARED Better Auth stubs. Under `isolate: false` a queued
    // `...Once` value outlives the file that set it and is consumed by
    // whichever test calls the stub next.
    _resetPatientAuthMocks();
    mockDb._resetMocks();
  });

  /** Unknown email: no lead, so nothing is created and nothing is sent. */
  const seedUnknownEmail = () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(undefined);
  };

  /** Known email with no recent code: the full mint-and-send path. */
  const seedKnownEmail = () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(lead);
    mockDb.query.customerAccount.findFirst.mockResolvedValueOnce({
      id: 'ca_1',
      email: 'pat@example.com',
    });
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce({
      id: 'pa_1',
      leadId: 'lead_1',
      organizationId: ORG.id,
      customerAccountId: 'ca_1',
    });
    // No recent OTP → the send proceeds.
    mockDb.query.patientVerification.findFirst.mockResolvedValueOnce(undefined);
  };

  it('creates nothing and sends nothing for an email with no lead here', async () => {
    seedUnknownEmail();

    const result = await requestOtp(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(patientAuth.api.sendVerificationOTP).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('mints and sends a code for a lead of this clinic', async () => {
    seedKnownEmail();

    const result = await requestOtp(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(patientAuth.api.sendVerificationOTP).toHaveBeenCalledTimes(1);
  });

  /**
   * The response must not distinguish the two. A different shape, or a
   * different status, is a direct answer to "is this person a patient here".
   */
  it('returns an identical response for a known and an unknown email', async () => {
    seedUnknownEmail();
    const unknown = await requestOtp(mockDb as never, input);

    mockDb._resetMocks();
    seedKnownEmail();
    const known = await requestOtp(mockDb as never, input);

    // Structure, not the millisecond: `expiresAt` is `now + TTL` in both
    // branches, so the two differ by however long the second call took. That
    // is not an oracle — it is computed the same way either way — while the
    // SHAPE is what a caller can actually read.
    expect(known.success).toBe(unknown.success);
    expect(Object.keys(known)).toEqual(Object.keys(unknown));
    if (known.success && unknown.success) {
      expect(Object.keys(known.data)).toEqual(Object.keys(unknown.data));
      expect(known.data.requested).toBe(unknown.data.requested);
    }
  });

  /**
   * The oracle a broken dependency turns on.
   *
   * Everything that can throw in this service sits AFTER the lead lookup, so
   * a failure is reachable only for an email that IS a patient here. Returning
   * INTERNAL_ERROR for it — while an unknown email kept returning the neutral
   * success — made the error itself the answer, no timing measurement needed.
   * A shaky database or a Better Auth hiccup was enough to switch it on.
   */
  it('stays neutral when a downstream dependency fails', async () => {
    seedKnownEmail();
    vi.mocked(patientAuth.api.sendVerificationOTP).mockRejectedValueOnce(
      new Error('Resend is down')
    );

    const result = await requestOtp(mockDb as never, input);

    expect(result.success).toBe(true);
  });

  it('suppresses a second send inside the resend cooldown, neutrally', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(lead);
    mockDb.query.customerAccount.findFirst.mockResolvedValueOnce({
      id: 'ca_1',
      email: 'pat@example.com',
    });
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce({
      id: 'pa_1',
      leadId: 'lead_1',
      organizationId: ORG.id,
      customerAccountId: 'ca_1',
    });
    // A code minted moments ago.
    mockDb.query.patientVerification.findFirst.mockResolvedValueOnce({
      id: 'ver_1',
      createdAt: new Date(),
    });

    const result = await requestOtp(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(patientAuth.api.sendVerificationOTP).not.toHaveBeenCalled();
  });

  it('reports an unknown clinic slug without touching any email', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);

    const result = await requestOtp(mockDb as never, input);

    // The slug is public, so a 404 on it reveals nothing about any person.
    expect(result.success).toBe(false);
    expect(mockDb.query.lead.findFirst).not.toHaveBeenCalled();
  });

  /**
   * BA's `allowedAttempts` cap is PER VERIFICATION ROW and it does not clear
   * prior rows: when the newest row burns its five guesses BA deletes it, and
   * the next-newest becomes live again with a fresh counter and its own valid
   * code. Five per row is not five per account — request a code every 61
   * seconds and roughly fifty guesses fit inside the ten-minute TTL.
   */
  it('clears earlier codes so the attempt cap cannot stack', async () => {
    seedKnownEmail();

    await requestOtp(mockDb as never, input);

    expect(mockDb.delete).toHaveBeenCalled();
    // Ordered: pruned only once the cooldown check has passed, so a rapid
    // resend short-circuits instead of churning rows.
    expect(patientAuth.api.sendVerificationOTP).toHaveBeenCalledTimes(1);
  });

  it('does not prune when the cooldown short-circuits the send', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(ORG);
    mockDb.query.lead.findFirst.mockResolvedValueOnce(lead);
    mockDb.query.customerAccount.findFirst.mockResolvedValueOnce({
      id: 'ca_1',
      email: 'pat@example.com',
    });
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce({
      id: 'pa_1',
      leadId: 'lead_1',
      organizationId: ORG.id,
      customerAccountId: 'ca_1',
    });
    mockDb.query.patientVerification.findFirst.mockResolvedValueOnce({
      id: 'ver_1',
      createdAt: new Date(),
    });

    await requestOtp(mockDb as never, input);

    // The code they were just sent stays valid — pruning here would
    // invalidate it and strand anyone who double-tapped "send".
    expect(mockDb.delete).not.toHaveBeenCalled();
  });
});
