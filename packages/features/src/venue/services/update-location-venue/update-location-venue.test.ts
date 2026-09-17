import { drizzleUniqueViolation } from '@borradh-workspace/database';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { updateLocationVenue } from './update-location-venue.service.js';

describe('updateLocationVenue', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  it('updates about + amenities + slug on the happy path', async () => {
    mockDb.returning.mockResolvedValueOnce([
      {
        locationId: 'loc-1',
        about: 'New about',
        amenities: ['free_wifi'],
        slug: 'south-branch',
      },
    ]);

    const result = await updateLocationVenue(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      about: 'New about',
      amenities: ['free_wifi'],
      slug: 'south-branch',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.locationId).toBe('loc-1');
      expect(result.data.about).toBe('New about');
      expect(result.data.amenities).toEqual(['free_wifi']);
      expect(result.data.slug).toBe('south-branch');
    }
  });

  it('returns VALIDATION_ERROR for an unknown amenity', async () => {
    const result = await updateLocationVenue(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      amenities: ['not_a_real_amenity'] as never,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('returns VALIDATION_ERROR when no fields are provided', async () => {
    const result = await updateLocationVenue(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toBe('No fields to update');
    }
  });

  it('returns NOT_FOUND when the location is not in the org', async () => {
    mockDb.returning.mockResolvedValueOnce([]);

    const result = await updateLocationVenue(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'missing',
      about: 'x',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('returns ALREADY_EXISTS when the slug collides on the unique constraint', async () => {
    mockDb.returning.mockRejectedValueOnce(
      drizzleUniqueViolation('organization_location_org_slug_unique')
    );

    const result = await updateLocationVenue(mockDb as never, {
      organizationId: 'org-1',
      locationId: 'loc-1',
      slug: 'taken',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.ALREADY_EXISTS);
    }
  });
});
