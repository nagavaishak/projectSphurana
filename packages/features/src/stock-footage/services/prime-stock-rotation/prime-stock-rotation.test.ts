import { drizzleFkViolation } from '@borradh-workspace/database';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as mintStockAssetsModule from '../mint-stock-assets/index.js';
import { primeStockRotation } from './prime-stock-rotation.service.js';

// The features suite runs `isolate: false`, so a file-local `vi.mock` of an
// internal module persists on the shared worker graph and races other files
// that import the real module (mint-stock-assets.test.ts). Use a restored
// `vi.spyOn` per the config's maintenance rule instead — see vitest.config.ts.
let mockMint: MockInstance;

const insertValues = vi.fn();
const onConflictDoNothing = vi.fn(() => ({ returning: insertValues }));

const mockDb = {
  query: {
    organization: { findFirst: vi.fn() },
    organizationService: {
      findFirst: vi.fn().mockResolvedValue({ regions: [] }),
    },
    serviceStockClip: { findMany: vi.fn() },
    stockClip: { findMany: vi.fn() },
  },
  insert: vi.fn(() => ({
    values: vi.fn(() => ({ onConflictDoNothing })),
  })),
};

const input = { organizationId: 'o1', serviceId: 'svc1', uploadedById: 'u1' };

// A stock_clip ref as returned by the shared resolver's column selection.
const clip = (id: string) => ({
  id,
  active: true,
  mediaType: 'video' as const,
  blobUrl: `b/${id}`,
  transcodedBlobUrl: null,
  durationSec: null,
  width: null,
  height: null,
  contentType: 'procedure',
  description: id,
  isGeneric: false,
  regions: [] as string[],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockMint = vi.spyOn(mintStockAssetsModule, 'mintStockAssets');
  mockDb.query.organization.findFirst.mockResolvedValue({
    businessType: 'aesthetic_clinic',
  });
  mockDb.query.serviceStockClip.findMany.mockResolvedValue([
    { stockClipId: 'c1', stockClip: clip('c1') },
  ]);
  mockDb.query.stockClip.findMany.mockResolvedValue([]);
  mockMint.mockImplementation((_db: never, arg: never) =>
    Promise.resolve({
      success: true,
      data: Object.fromEntries(
        (arg as { stockClipIds: string[] }).stockClipIds.map((id) => [
          id,
          `asset-${id}`,
        ])
      ),
    })
  );
  insertValues.mockResolvedValue([{ id: 'link-1' }]);
});

// Restore the real binding so the spy never leaks onto the shared worker graph.
afterEach(() => {
  mockMint.mockRestore();
});

describe('primeStockRotation', () => {
  it('links the matched stock asset into the service pool', async () => {
    const result = await primeStockRotation(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        assetIds: ['asset-c1'],
        linksCreated: 1,
      });
    }
  });

  // The service (or the just-minted asset) was deleted between resolving the
  // stock refs and this insert — a genuine race, not a bug in the earlier
  // reads. drizzle wraps the postgres.js error so the constraint lives on the
  // `.cause` chain, not `error.message` (ENG-844).
  it('returns NOT_FOUND when the link insert races a deleted service or asset', async () => {
    insertValues.mockRejectedValueOnce(
      drizzleFkViolation('asset_service_asset_id_asset_id_fk')
    );

    const result = await primeStockRotation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND for a race on the service-side foreign key too', async () => {
    insertValues.mockRejectedValueOnce(
      drizzleFkViolation('asset_service_service_id_organization_service_id_fk')
    );

    const result = await primeStockRotation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('rethrows an insert failure unrelated to the asset_service FKs rather than swallowing it', async () => {
    insertValues.mockRejectedValueOnce(new Error('connection reset'));

    await expect(primeStockRotation(mockDb as never, input)).rejects.toThrow(
      'connection reset'
    );
  });

  it('returns an empty result without inserting when no service-matched clips exist', async () => {
    mockDb.query.serviceStockClip.findMany.mockResolvedValueOnce([]);

    const result = await primeStockRotation(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ assetIds: [], linksCreated: 0 });
    }
    expect(mockDb.insert).not.toHaveBeenCalled();
  });
});
