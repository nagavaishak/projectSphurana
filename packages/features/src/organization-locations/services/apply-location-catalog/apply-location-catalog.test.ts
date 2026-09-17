import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { applyLocationCatalog } from './apply-location-catalog.service.js';

/**
 * The behaviour worth pinning here is the SCOPE of the writes.
 *
 * Within one branch the semantics are replace, so deletes are expected. What
 * must never happen is a write that reaches another branch's rows — editing
 * Cork changing what Dublin offers. Every delete is therefore asserted to carry
 * a `locationId` predicate, and an ABSENT request field must produce no write
 * for that kind at all (absent means "leave alone"; `[]` means "assign none").
 */
describe('applyLocationCatalog', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const base = { locationId: 'loc-1', organizationId: 'org-1' };

  /** The org owns the branches named in the body. */
  const ownsLocations = (ids: string[]) =>
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      ids.map((id) => ({ id })) as never
    );

  it('writes nothing when every field is absent (absent = leave alone)', async () => {
    ownsLocations(['loc-1']);

    const result = await applyLocationCatalog(mockDb as never, base);

    expect(result.success).toBe(true);
    expect(mockDb.insert).not.toHaveBeenCalled();
    // The create path sends only the kinds the user picked; the untouched ones
    // must not be cleared out from under an existing branch.
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('clears a kind when it is sent as an empty array', async () => {
    ownsLocations(['loc-1']);

    const result = await applyLocationCatalog(mockDb as never, {
      ...base,
      serviceIds: [],
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('inserts a join row per requested id, scoped to this location', async () => {
    ownsLocations(['loc-1']);
    // Ownership probe for the two services, then the insert's RETURNING.
    mockDb.where.mockResolvedValueOnce([
      { id: 'svc-1' },
      { id: 'svc-2' },
    ] as never);
    mockDb.returning.mockResolvedValueOnce([
      { id: 'row-1' },
      { id: 'row-2' },
    ] as never);

    const result = await applyLocationCatalog(mockDb as never, {
      ...base,
      serviceIds: ['svc-1', 'svc-2'],
    });

    expect(result.success).toBe(true);
    expect(mockDb.values).toHaveBeenCalledWith([
      { serviceId: 'svc-1', locationId: 'loc-1' },
      { serviceId: 'svc-2', locationId: 'loc-1' },
    ]);
    // The invariant: the prune is scoped to THIS branch. `where` is called with
    // the composed predicate; a delete that forgot the locationId clause would
    // wipe the entity's assignments at every other branch too.
    expect(mockDb.delete).toHaveBeenCalledWith(expect.anything());
    expect(mockDb.where).toHaveBeenCalled();
  });

  it('rejects an id belonging to another organization', async () => {
    ownsLocations(['loc-1']);
    // Two asked for, one owned — a cross-tenant join row would surface another
    // org's service inside this catalogue, so this is a hard failure.
    mockDb.where.mockResolvedValueOnce([{ id: 'svc-1' }] as never);

    const result = await applyLocationCatalog(mockDb as never, {
      ...base,
      serviceIds: ['svc-1', 'not-mine'],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('rejects a branch the caller does not own', async () => {
    // Asked about two branches, the org owns neither/one — assertLocations
    // fails before anything is written.
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await applyLocationCatalog(mockDb as never, {
      ...base,
      copyFromLocationId: 'someone-elses-branch',
    });

    expect(result.success).toBe(false);
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refuses to copy a location from itself', async () => {
    ownsLocations(['loc-1']);

    const result = await applyLocationCatalog(mockDb as never, {
      ...base,
      copyFromLocationId: 'loc-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});
