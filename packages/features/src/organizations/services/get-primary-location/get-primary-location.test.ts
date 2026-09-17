import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { getPrimaryLocation } from './get-primary-location.service.js';

const findFirst = vi.fn();
const db = { query: { organizationLocation: { findFirst } } } as never;

describe('getPrimaryLocation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the geocoded location with a street + town label', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      name: null,
      addressLine1: 'Pelham Street, Hanley',
      city: 'Stoke on Trent',
      country: 'GB',
      latitude: 53.0201,
      longitude: -2.1695242,
    });

    const result = await getPrimaryLocation(db, { organizationId: 'org_1' });
    expect(result.success).toBe(true);
    if (!result.success || !result.data) return;
    expect(result.data.label).toBe('Pelham Street, Hanley, Stoke on Trent');
    expect(result.data.latitude).toBe(53.0201);
    expect(result.data.longitude).toBe(-2.1695242);
    expect(result.data.city).toBe('Stoke on Trent');
  });

  it('uses just the town when the street already contains it', async () => {
    findFirst.mockResolvedValueOnce({
      id: 'loc_1',
      name: null,
      addressLine1: 'Stoke on Trent',
      city: 'Stoke on Trent',
      country: 'GB',
      latitude: null,
      longitude: null,
    });
    const result = await getPrimaryLocation(db, { organizationId: 'org_1' });
    expect(result.success && result.data?.label).toBe('Stoke on Trent');
  });

  it('returns null (not an error) when the org has no location', async () => {
    findFirst.mockResolvedValueOnce(undefined);
    const result = await getPrimaryLocation(db, { organizationId: 'org_1' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });
});
