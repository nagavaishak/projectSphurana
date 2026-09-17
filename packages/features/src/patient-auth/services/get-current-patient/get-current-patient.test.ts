import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { getCurrentPatient } from './get-current-patient.service.js';

describe('getCurrentPatient', () => {
  const mockDb = createMockDatabase();

  const validInput = {
    leadId: 'lead_123',
    organizationId: 'org_123',
  };

  /**
   * A lead row carrying BOTH note columns.
   *
   * In production the driver can no longer return `notes` at all — migration
   * 0135 narrows `app_patient`'s column grant, so a select that asked for it
   * would be "permission denied" (pinned in rls-patient-isolation.test.ts).
   * The mock keeps it anyway: this suite's job is to prove the mapping layer
   * drops it even when handed a row that has it, which is the state every
   * caller with a wider grant (staff, system) still sees.
   */
  const leadRow = {
    id: 'lead_123',
    organizationId: 'org_123',
    firstName: 'Pat',
    lastName: 'Gogia',
    email: 'pat@example.com',
    phone: '+353871234567',
    notes: 'INTERNAL: chases discounts, do not offer the promo again.',
    portalNote: 'Please arrive 10 minutes early.',
  };

  /**
   * The service selects an EXPLICIT column list and terminates with `.limit(1)`
   * — not `query.lead.findFirst`, which emits `select *` and would now be
   * refused by the narrowed grant. Terminate the chain accordingly.
   */
  const mockLeadRow = (row: Record<string, unknown> | undefined) => {
    mockDb.limit.mockResolvedValueOnce(row ? [row] : []);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the clinic note addressed to the customer', async () => {
    mockLeadRow(leadRow);

    const result = await getCurrentPatient(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.portalNote).toBe('Please arrive 10 minutes early.');
    }
  });

  /**
   * The whole reason `portalNote` is a separate column. `lead.notes` holds
   * staff-internal commentary written on the assumption no customer would
   * ever read it — if it reaches this payload it is published to that
   * customer's portal for every existing record at once.
   */
  it('never exposes staff-internal notes to the portal payload', async () => {
    mockLeadRow(leadRow);

    const result = await getCurrentPatient(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(JSON.stringify(result.data)).not.toContain('INTERNAL');
      expect(result.data).not.toHaveProperty('notes');
    }
  });

  /**
   * Belt to the RLS braces: the grant stops the DB returning `notes`, and this
   * stops us ever asking. Without it, widening the projection back to a
   * star-select would only surface as a runtime "permission denied" in an
   * RLS-enabled environment — which previews are not.
   */
  it('never asks the database for a column the portal may not read', async () => {
    mockLeadRow(leadRow);

    await getCurrentPatient(mockDb as never, validInput);

    expect(mockDb.select).toHaveBeenCalledTimes(1);
    const projection = mockDb.select.mock.calls[0][0] as
      | Record<string, unknown>
      | undefined;

    // An argument-less select() is `select *` — exactly what the narrowed
    // grant refuses.
    expect(projection).toBeDefined();
    expect(Object.keys(projection ?? {}).sort()).toEqual([
      'email',
      'firstName',
      'id',
      'lastName',
      'organizationId',
      'phone',
      'portalNote',
    ]);
  });

  it('returns a null note when the clinic has not written one', async () => {
    mockLeadRow({ ...leadRow, portalNote: null });

    const result = await getCurrentPatient(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.portalNote).toBeNull();
  });

  it('is NOT_FOUND when the row is filtered away or absent', async () => {
    mockLeadRow(undefined);

    const result = await getCurrentPatient(mockDb as never, validInput);

    expect(result.success).toBe(false);
  });
});
