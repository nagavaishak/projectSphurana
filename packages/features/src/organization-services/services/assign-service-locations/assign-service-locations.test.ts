import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { assignServiceLocations } from './assign-service-locations.service.js';

describe('assignServiceLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    serviceId: 'svc-1',
    organizationId: 'org-1',
    locations: [{ locationId: 'loc-1' }],
  };

  const ownService = { id: 'svc-1' };

  it('replaces the assignments, carrying the price override', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    const result = await assignServiceLocations(mockDb as never, {
      ...validInput,
      locations: [
        {
          locationId: 'loc-1',
          priceCentsOverride: 22000,
          durationMinutesOverride: null,
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.values).toHaveBeenCalledWith([
      {
        serviceId: 'svc-1',
        locationId: 'loc-1',
        priceCentsOverride: 22000,
        durationMinutesOverride: null,
      },
    ]);
  });

  it('keeps a ZERO price override rather than nulling it', async () => {
    // `?? null` and not `|| null`: a branch that gives a service away free is
    // a real thing, and `0 || null` silently becomes "inherit the org price".
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    await assignServiceLocations(mockDb as never, {
      ...validInput,
      locations: [{ locationId: 'loc-1', priceCentsOverride: 0 }],
    });

    expect(mockDb.values).toHaveBeenCalledWith([
      expect.objectContaining({ priceCentsOverride: 0 }),
    ]);
  });

  it('an EMPTY array clears the rows — which means "offered everywhere"', async () => {
    // The single most misreadable behaviour in this endpoint. Zero join rows
    // is the "available at every branch" default the read path is built on, so
    // `[]` RESTORES availability. It must delete and insert nothing.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );

    const result = await assignServiceLocations(mockDb as never, {
      ...validInput,
      locations: [],
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('refuses a branch belonging to another org, and writes nothing', async () => {
    // The cross-tenant WRITE. Without this check the join row would surface
    // the service — and its overridden price — inside another org's catalogue.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    // Only one of the two ids comes back as owned.
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    await expectResult(
      assignServiceLocations(mockDb as never, {
        ...validInput,
        locations: [
          { locationId: 'loc-1' },
          { locationId: 'loc-belonging-to-org-2' },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it('returns NOT_FOUND for a service belonging to another org', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      undefined as never
    );

    await expectResult(
      assignServiceLocations(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  // ── Per-branch VARIANT prices ────────────────────────────────────────────
  // A variant-priced service has no single price to override: `priceCents` on
  // the service row is a "from". Moving it without the options it summarises
  // leaves the headline and the list contradicting each other, so both are
  // written by the same call.

  it('writes variant prices with the service derived, not caller-supplied', async () => {
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce([
      { id: 'var-1' },
      { id: 'var-2' },
    ] as never);

    const result = await assignServiceLocations(mockDb as never, {
      ...validInput,
      locations: [
        {
          locationId: 'loc-1',
          variantOverrides: [
            { variantId: 'var-1', priceCentsOverride: 22000 },
            { variantId: 'var-2', priceCentsOverride: 30000 },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    // `serviceId` is an RLS routing column — it must come from the service
    // under edit, never from the request body.
    expect(mockDb.values).toHaveBeenCalledWith([
      {
        variantId: 'var-1',
        serviceId: 'svc-1',
        locationId: 'loc-1',
        priceCentsOverride: 22000,
      },
      {
        variantId: 'var-2',
        serviceId: 'svc-1',
        locationId: 'loc-1',
        priceCentsOverride: 30000,
      },
    ]);
  });

  it('refuses a variant belonging to ANOTHER service, and writes nothing', async () => {
    // The read path keys purely on variantId, so a foreign variant priced here
    // would surface inside the other service's catalogue at this branch.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce([
      { id: 'var-1' },
    ] as never);

    await expectResult(
      assignServiceLocations(mockDb as never, {
        ...validInput,
        locations: [
          {
            locationId: 'loc-1',
            variantOverrides: [
              { variantId: 'var-1', priceCentsOverride: 22000 },
              { variantId: 'var-from-another-service', priceCentsOverride: 1 },
            ],
          },
        ],
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.insert).not.toHaveBeenCalled();
  });

  it("an empty variantOverrides array CLEARS that branch's variant prices", async () => {
    // Same replace-semantics as the surrounding endpoint: [] means "back to
    // the variants' own prices", not "leave them alone".
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);
    mockDb.query.organizationServiceVariant.findMany.mockResolvedValueOnce(
      [] as never
    );

    const result = await assignServiceLocations(mockDb as never, {
      ...validInput,
      locations: [{ locationId: 'loc-1', variantOverrides: [] }],
    });

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('leaves variant prices untouched when the key is omitted', async () => {
    // Omitted is NOT the same as empty — a caller editing only which branches
    // offer a service must not silently wipe their per-branch prices.
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(
      ownService as never
    );
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      { id: 'loc-1' },
    ] as never);

    const result = await assignServiceLocations(mockDb as never, {
      ...validInput,
      locations: [{ locationId: 'loc-1' }],
    });

    expect(result.success).toBe(true);
    expect(
      mockDb.query.organizationServiceVariant.findMany
    ).not.toHaveBeenCalled();
  });
});
