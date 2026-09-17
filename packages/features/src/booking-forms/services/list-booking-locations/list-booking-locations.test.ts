import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { listBookingLocations } from './list-booking-locations.service.js';

const org = {
  id: 'org-1',
  name: 'Test Salon',
  slug: 'test-salon',
  logo: 'https://example.com/logo.png',
  businessHours: { 1: { from: 540, to: 1020 } },
};

const branch = (over: Record<string, unknown> = {}) => ({
  id: 'loc-1',
  slug: 'dublin',
  name: 'Dublin Branch',
  addressLine1: '1 Main Street',
  addressLine2: null,
  city: 'Dublin',
  county: 'Dublin',
  postalCode: 'D01 XY00',
  country: 'IE',
  latitude: 53.3,
  longitude: -6.2,
  openingHours: null,
  isPrimary: true,
  ...over,
});

describe('listBookingLocations', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
  });

  const validInput = { organizationSlug: 'test-salon' };

  it('returns every branch of the org as a chooser card', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      branch(),
      branch({
        id: 'loc-2',
        slug: 'cork',
        name: 'Cork Branch',
        isPrimary: false,
        openingHours: { 2: { from: 600, to: 1080 } },
      }),
    ]);
    // Branch galleries, then org-wide shared photos.
    mockDb.query.organizationPhoto.findMany
      .mockResolvedValueOnce([
        {
          locationId: 'loc-1',
          url: 'https://cdn/dublin.jpg',
          isCover: true,
          sortOrder: 0,
        },
      ])
      .mockResolvedValueOnce([
        { url: 'https://cdn/shared.jpg', isCover: false, sortOrder: 0 },
      ]);

    const result = await listBookingLocations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.organizationName).toBe('Test Salon');
    expect(result.data.locations).toHaveLength(2);

    const [dublin, cork] = result.data.locations;
    expect(dublin.slug).toBe('dublin');
    expect(dublin.addressLine1).toBe('1 Main Street');
    expect(dublin.photo).toBe('https://cdn/dublin.jpg');
    expect(dublin.isPrimary).toBe(true);
    // No standing branch hours → the org's business hours, as the venue page
    // resolves them.
    expect(dublin.openingHours).toEqual({ 1: { from: 540, to: 1020 } });

    // No gallery of its own → the org-wide photo, not a blank card.
    expect(cork.photo).toBe('https://cdn/shared.jpg');
    // Its own standing hours win over the org's.
    expect(cork.openingHours).toEqual({ 2: { from: 600, to: 1080 } });
  });

  it('never leaks anything beyond the chooser card fields', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      branch({
        // Columns a chooser card has no business publishing.
        stripeTerminalLocationId: 'tml_secret',
        about: 'internal prose',
        amenities: ['pet_friendly'],
      }),
    ]);
    mockDb.query.organizationPhoto.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listBookingLocations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.keys(result.data.locations[0]).sort()).toEqual(
      [
        'addressLine1',
        'addressLine2',
        'city',
        'country',
        'county',
        'id',
        'isPrimary',
        'latitude',
        'longitude',
        'name',
        'openingHours',
        'photo',
        'postalCode',
        'slug',
      ].sort()
    );
  });

  it('returns a one-element list for a single-branch org (no special case)', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([
      branch(),
    ]);
    mockDb.query.organizationPhoto.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listBookingLocations(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.locations).toHaveLength(1);
    expect(result.data.locations[0].photo).toBeNull();
  });

  it('returns NOT_FOUND for an unknown org', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await listBookingLocations(mockDb as never, {
      organizationSlug: 'nope',
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns NOT_FOUND when the org has no locations', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findMany.mockResolvedValueOnce([]);

    const result = await listBookingLocations(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
  });

  it('returns VALIDATION_ERROR for a blank slug', async () => {
    const result = await listBookingLocations(mockDb as never, {
      organizationSlug: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.query.organization.findFirst).not.toHaveBeenCalled();
  });
});
