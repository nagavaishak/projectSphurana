import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import {
  findOrCreateCustomerAccount,
  findOrCreatePatientAuthMembership,
} from './lookups.js';

/**
 * One portal membership per person per clinic.
 *
 * Duplicate LEAD rows for the same person are the normal state of a CRM — they
 * book online, then phone, then arrive as a walk-in, and Meta lead ads add a
 * fourth. Keyed on `lead_id` alone, each of those grew its own membership, and
 * the resolver then picked between them with an unordered findFirst: the
 * customer's bookings appeared and disappeared between page loads, and two
 * family members sharing an email at one clinic could be shown each other's
 * records.
 *
 * The (customer_account, organization) pair is the real identity. Resolving on
 * it FIRST is what makes duplicate leads converge; `uq_patient_auth_account_org`
 * (0137) then makes a second row impossible. Both halves are needed — without
 * the lookup change the constraint would turn a duplicate lead into a hard
 * sign-in failure instead of a stable one.
 */
describe('findOrCreatePatientAuthMembership', () => {
  const mockDb = createMockDatabase();

  const params = {
    leadId: 'lead_2',
    organizationId: 'org_1',
    customerAccountId: 'ca_1',
    relink: true,
  };

  const existingMembership = {
    id: 'pa_1',
    leadId: 'lead_1', // ← the FIRST lead row for this person
    organizationId: 'org_1',
    customerAccountId: 'ca_1',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  /**
   * The structural property, asserted on the LOOKUP ORDER.
   *
   * The mock returns the same value for any query, so "which row came back"
   * cannot distinguish the two implementations — both take the first queued
   * value. The CALL COUNT can: resolving the (account, org) pair first means
   * two lookups happen when nothing is found, and only one when the identity
   * lookup already answers. Keyed on `lead_id` alone there is exactly one
   * lookup either way.
   *
   * The end-to-end property — that a duplicate lead cannot produce a second
   * membership — is enforced by `uq_patient_auth_account_org` and verified
   * against a real postgres (see 0137).
   */
  it('resolves the person’s identity BEFORE falling back to the lead', async () => {
    mockDb.query.patientAuth.findFirst
      .mockResolvedValueOnce(undefined) // no (account, org) row
      .mockResolvedValueOnce(undefined); // no lead-keyed row
    mockDb.returning.mockResolvedValueOnce([
      { id: 'pa_new', ...params },
    ] as never);

    await findOrCreatePatientAuthMembership(mockDb as never, params);

    // Two lookups: the identity pair, then the lead. Dropping the identity
    // lookup makes this one.
    expect(mockDb.query.patientAuth.findFirst).toHaveBeenCalledTimes(2);
  });

  it('reuses the person’s existing membership without a second lookup', async () => {
    mockDb.query.patientAuth.findFirst.mockResolvedValueOnce(
      existingMembership
    );

    const result = await findOrCreatePatientAuthMembership(
      mockDb as never,
      params
    );

    // Signed in via lead_2, resolved to the membership hanging off lead_1 —
    // stable, rather than flapping between the duplicates.
    expect(result.leadId).toBe('lead_1');
    // Short-circuited: the lead-keyed lookup never ran, and no second
    // membership was created (0137 would now reject one anyway).
    expect(mockDb.query.patientAuth.findFirst).toHaveBeenCalledTimes(1);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('creates a membership for a person with none at this clinic', async () => {
    mockDb.query.patientAuth.findFirst
      .mockResolvedValueOnce(undefined) // no (account, org) row
      .mockResolvedValueOnce(undefined); // no lead-keyed row
    mockDb.returning.mockResolvedValueOnce([
      { id: 'pa_new', ...params },
    ] as never);

    const result = await findOrCreatePatientAuthMembership(
      mockDb as never,
      params
    );

    expect(result.id).toBe('pa_new');
    expect(mockDb.insert).toHaveBeenCalled();
  });

  /**
   * The pre-existing re-link path must survive: a membership whose lead's
   * email now resolves to a DIFFERENT account is re-pointed at that account.
   * Reached only when the person has no membership here yet, so it cannot
   * collide with the new constraint.
   */
  it('still re-links a membership whose lead now belongs to another account', async () => {
    mockDb.query.patientAuth.findFirst
      .mockResolvedValueOnce(undefined) // no (account, org) row
      .mockResolvedValueOnce({
        ...existingMembership,
        leadId: 'lead_2',
        customerAccountId: 'ca_OLD',
      });
    mockDb.returning.mockResolvedValueOnce([
      { ...existingMembership, leadId: 'lead_2', customerAccountId: 'ca_1' },
    ] as never);

    const result = await findOrCreatePatientAuthMembership(
      mockDb as never,
      params
    );

    expect(mockDb.update).toHaveBeenCalled();
    expect(result.customerAccountId).toBe('ca_1');
  });

  /**
   * Re-pointing a membership at a different account is an IDENTITY TRANSFER,
   * and it used to be reachable from `request-otp` — an unauthenticated
   * endpoint. That made `lead.email` an account-takeover primitive for any
   * flow able to change it without proving ownership of the new address.
   *
   * The audit found no such flow today (the public booking form matches on
   * email and only touches status; imports never write email on update; the
   * voice and campaign paths write status fields; `updateLead` is staff-only),
   * so this closes the shape rather than a live hole. Requesting a code needs
   * only to know a lead exists — it mutates nothing.
   */
  it('does NOT move a membership when re-linking is withheld', async () => {
    mockDb.query.patientAuth.findFirst
      .mockResolvedValueOnce(undefined) // no (account, org) row
      .mockResolvedValueOnce({
        ...existingMembership,
        leadId: 'lead_2',
        customerAccountId: 'ca_OLD',
      });

    const result = await findOrCreatePatientAuthMembership(mockDb as never, {
      ...params,
      relink: false,
    });

    // Returned as it stands — enough to decide whether to send a code.
    expect(result.customerAccountId).toBe('ca_OLD');
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  /**
   * LOSING THE INSERT RACE.
   *
   * SELECT-then-INSERT has a window, and 0137 added
   * `uq_patient_auth_account_org`. Before that constraint the loser quietly
   * wrote a duplicate row; after it, a raised 23505 aborts the enclosing
   * `withSystemScope` transaction — there is no recovery inside an aborted
   * transaction, so the whole request 500s with a generic message. That is the
   * shape seen in CI: `Failed to mint patient OTP … An unexpected error
   * occurred`, on the FIRST attempt, passing on retry.
   *
   * `ON CONFLICT DO NOTHING` keeps the transaction usable and returns no row;
   * the winner's row is then read back. Without the re-read this returns
   * `undefined` and every caller dereferences it.
   */
  it('returns the winner’s membership when its own insert conflicts', async () => {
    mockDb.query.patientAuth.findFirst
      .mockResolvedValueOnce(undefined) // no (account, org) row yet
      .mockResolvedValueOnce(undefined) // no lead-keyed row either
      .mockResolvedValueOnce(existingMembership); // …the winner's, re-read

    // ON CONFLICT DO NOTHING returns nothing when the row already exists.
    mockDb.returning.mockResolvedValueOnce([] as never);

    const result = await findOrCreatePatientAuthMembership(
      mockDb as never,
      params
    );

    expect(result).toBeDefined();
    expect(result.id).toBe('pa_1');
    // Re-read on the IDENTITY pair, which is the constraint that fired — the
    // winner may have hung the membership off a different duplicate lead.
    expect(mockDb.query.patientAuth.findFirst).toHaveBeenCalledTimes(3);
  });
});

/**
 * One email is one account, and 0137's `uq_customer_account_email_lower`
 * enforces it. Same race, same failure mode as the membership insert above:
 * two concurrent sign-ins for a person with no account yet.
 */
describe('findOrCreateCustomerAccount', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the winner’s account when its own insert conflicts', async () => {
    mockDb.query.customerAccount.findFirst
      .mockResolvedValueOnce(undefined) // nothing on the initial lookup
      .mockResolvedValueOnce({ id: 'ca_winner', email: 'a@b.com' }); // re-read

    mockDb.returning.mockResolvedValueOnce([] as never);

    const result = await findOrCreateCustomerAccount(
      mockDb as never,
      'A@B.com' // also pins normalization: the re-read must use the lowered form
    );

    expect(result.id).toBe('ca_winner');
    expect(mockDb.query.customerAccount.findFirst).toHaveBeenCalledTimes(2);
  });

  it('returns its own row when it wins the race', async () => {
    mockDb.query.customerAccount.findFirst.mockResolvedValueOnce(undefined);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'ca_new', email: 'a@b.com' },
    ] as never);

    const result = await findOrCreateCustomerAccount(
      mockDb as never,
      'a@b.com'
    );

    expect(result.id).toBe('ca_new');
    // No re-read needed when the insert actually wrote.
    expect(mockDb.query.customerAccount.findFirst).toHaveBeenCalledTimes(1);
  });
});
