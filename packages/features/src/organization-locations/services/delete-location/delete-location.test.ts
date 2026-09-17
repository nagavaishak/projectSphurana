import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { deleteLocation } from './delete-location.service.js';

describe('deleteLocation', () => {
  const mockDb = createMockDatabase();

  /**
   * Rows the service will read, keyed by TABLE NAME rather than by call order.
   *
   * `db.select(…).from(table).where(…)` is the only read shape the service
   * uses, and `from` is the one link in that chain that is handed the table —
   * so stubbing there makes each fixture say which table it belongs to instead
   * of which call number it is. That matters here: the join-table branch reads
   * the same table twice (once to find the entities assigned to the branch,
   * once inside `removeLocationLink` to see how many branches each one has),
   * and an order-indexed stub would silently swap them.
   *
   * A join fixture therefore carries BOTH shapes on one row — `ownerId` for the
   * first read, `locationId` for the second.
   */
  const tableRows = new Map<string, unknown[]>();

  /** Which tables the service issued an UPDATE / DELETE against. */
  const updatedTables = () =>
    mockDb.update.mock.calls.map((call) => getTableName(call[0] as PgTable));
  const deletedTables = () =>
    mockDb.delete.mock.calls.map((call) => getTableName(call[0] as PgTable));

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    tableRows.clear();

    mockDb.from.mockImplementation((table: PgTable) => ({
      where: vi
        .fn()
        .mockResolvedValue(tableRows.get(getTableName(table)) ?? []),
    }));
  });

  const validInput = {
    id: 'loc-1',
    organizationId: 'org-123',
  };

  /** The branch being deleted, plus a sibling so it is never the last one. */
  const twoBranches = [
    { id: 'loc-1', isPrimary: false },
    { id: 'loc-2', isPrimary: true },
  ];

  const withTwoBranches = () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      twoBranches
    );
  };

  it('deletes a non-primary location when another location remains', async () => {
    withTwoBranches();

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ success: true });
    }
    expect(deletedTables()).toContain('organization_location');
  });

  it('returns NOT_FOUND when the location does not belong to the org', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'someone-elses-loc', isPrimary: true },
      { id: 'another-loc', isPrimary: false },
    ]);

    await expectResult(
      deleteLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND when the org has no locations at all', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);

    await expectResult(
      deleteLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // --- The guards -----------------------------------------------------------
  // The UI hides the delete button for the primary branch; the API is reachable
  // regardless, so these assert the refusal at the service layer.

  it('refuses to delete the primary location', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', isPrimary: true },
      { id: 'loc-2', isPrimary: false },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toMatch(/primary location/i);
      expect(result.error.details).toMatchObject({
        reason: 'primary_location',
      });
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete the last remaining location', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', isPrimary: true },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.message).toMatch(/only location/i);
      expect(result.error.details).toMatchObject({ reason: 'last_location' });
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('reports the last-location reason even when the only branch is not flagged primary', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', isPrimary: false },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.details).toMatchObject({ reason: 'last_location' });
    }
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // --- 1. Availability join rows -------------------------------------------
  // The reason this lane exists. Zero join rows means "available at EVERY
  // branch", so a cascade that drops an entity's last row PUBLISHES it
  // everywhere.

  it('does NOT leave a service that was assigned only to the deleted branch available everywhere', async () => {
    withTwoBranches();
    // One join row, at the branch being deleted: the exact inversion case.
    tableRows.set('organization_service_location', [
      { ownerId: 'svc-cork-only', locationId: 'loc-1' },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // Withdrawn, not republished: the service is deactivated rather than being
    // left on zero rows and read as "offered at every branch".
    expect(updatedTables()).toContain('organization_service');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
  });

  it('unlinks a service that is still offered at another branch, and leaves it active', async () => {
    withTwoBranches();
    tableRows.set('organization_service_location', [
      { ownerId: 'svc-both', locationId: 'loc-1' },
      { ownerId: 'svc-both', locationId: 'loc-2' },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    // The join row for the deleted branch goes; the service itself is untouched
    // because it is still explicitly offered at loc-2.
    expect(deletedTables()).toContain('organization_service_location');
    expect(updatedTables()).not.toContain('organization_service');
  });

  it('withdraws a practitioner whose only branch was deleted rather than moving them to another branch', async () => {
    withTwoBranches();
    tableRows.set('practitioner_location', [
      { ownerId: 'prac-cork-only', locationId: 'loc-1' },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(updatedTables()).toContain('practitioner');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false })
    );
  });

  it('pauses an offer whose only branch was deleted (offer has no isActive)', async () => {
    withTwoBranches();
    tableRows.set('offer_location', [
      { ownerId: 'offer-cork-only', locationId: 'loc-1' },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(updatedTables()).toContain('offer');
    expect(mockDb.set).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'paused' })
    );
  });

  it('leaves entities that were never assigned to any branch alone', async () => {
    withTwoBranches();
    // No join rows anywhere: everything already means "every branch", and after
    // the delete it means every REMAINING branch. Nothing to reassign.

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(updatedTables()).not.toContain('organization_service');
    expect(updatedTables()).not.toContain('product');
    expect(updatedTables()).not.toContain('practitioner');
  });

  it('drops the branch variant price overrides outright', async () => {
    withTwoBranches();

    await deleteLocation(mockDb as never, validInput);

    // These rows are per-branch PRICES, not availability — nothing reads them
    // through `atLocationOrUnassigned`, so there is nothing to preserve.
    expect(deletedTables()).toContain('organization_service_variant_location');
  });

  // --- 2. Trading history → refuse -----------------------------------------

  it.each([
    ['sale', 'sales'],
    ['stock_take', 'stockTakes'],
    ['stock_order', 'stockOrders'],
    ['product_stock', 'productStock'],
  ])('refuses to delete a branch that has %s rows', async (table, key) => {
    withTwoBranches();
    tableRows.set(table, [{ value: 3 }]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
      expect(result.error.details).toMatchObject({
        reason: 'trading_history',
        blocking: { [key]: 3 },
      });
    }
    expect(deletedTables()).not.toContain('organization_location');
  });

  it('refuses on PAST appointments and reports every blocking table at once', async () => {
    withTwoBranches();
    tableRows.set('appointment', [{ value: 12 }]);
    tableRows.set('sale', [{ value: 4 }]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.details).toMatchObject({
        reason: 'trading_history',
        blocking: { pastAppointments: 12, sales: 4 },
      });
    }
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(deletedTables()).not.toContain('organization_location');
  });

  it('refuses BEFORE reassigning anything, so a blocked delete writes nothing', async () => {
    withTwoBranches();
    tableRows.set('sale', [{ value: 1 }]);
    tableRows.set('organization_service_location', [
      { ownerId: 'svc-cork-only', locationId: 'loc-1' },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(false);
    expect(mockDb.update).not.toHaveBeenCalled();
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // --- 3. Forward-looking rows → reassign to the primary --------------------

  it('reassigns blocks, time off, shifts, future appointments, leads and campaigns to the primary branch', async () => {
    withTwoBranches();

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    for (const table of [
      'blocked_time',
      'time_off',
      'shift',
      'appointment',
      'lead',
      'meta_campaign_config',
    ]) {
      expect(updatedTables()).toContain(table);
    }
    // loc-2 is the primary sibling.
    expect(mockDb.set).toHaveBeenCalledWith({ locationId: 'loc-2' });
    expect(mockDb.set).toHaveBeenCalledWith({ primaryLocationId: 'loc-2' });
  });

  it('falls back to a sibling branch when no location is flagged primary', async () => {
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1', isPrimary: false },
      { id: 'loc-9', isPrimary: false },
    ]);

    const result = await deleteLocation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.set).toHaveBeenCalledWith({ locationId: 'loc-9' });
  });

  // --- Input + failure modes ------------------------------------------------

  it('returns VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      deleteLocation(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      deleteLocation(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns INTERNAL_ERROR on DB failure', async () => {
    mockDb.query.organizationLocation.findMany.mockRejectedValueOnce(
      new Error('DB failed')
    );

    await expectResult(
      deleteLocation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.INTERNAL_ERROR);
  });
});
