import { practitionerLocation } from '@borradh-workspace/database';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getVenueConfig } from './get-venue-config.service.js';

describe('getVenueConfig', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  beforeEach(() => {
    mockDb = createMockDatabase();
  });

  const org = {
    id: 'org-1',
    name: 'Glow Clinic',
    slug: 'glow-clinic',
    logo: 'https://cdn/logo.png',
    timezone: 'Europe/Dublin',
    businessHours: { 1: { from: 540, to: 1080 } },
    reschedulingNoticeRequiredHours: 24,
    noShowOrLateCancelFeeCents: 500,
  };

  const primaryLocation = {
    id: 'loc-1',
    slug: null,
    name: 'Main Clinic',
    about: 'A lovely clinic',
    amenities: ['free_wifi', 'parking_available'],
    addressLine1: '1 Main St',
    addressLine2: null,
    city: 'Dublin',
    county: null,
    postalCode: 'D01 AB12',
    country: 'IE',
    latitude: 53.3,
    longitude: -6.2,
    openingHours: { 1: { from: 600, to: 1020 } },
  };

  it('returns VALIDATION_ERROR for empty slug', async () => {
    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when organization does not exist', async () => {
    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: 'unknown',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Organization not found');
    }
  });

  it('returns NOT_FOUND when the organization has no matching location', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    // organizationLocation.findFirst defaults to null (no location resolves).

    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: 'glow-clinic',
      locationSlug: 'ghost-branch',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Location not found');
    }
  });

  it('resolves the PRIMARY location when no locationSlug is given', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      primaryLocation
    );
    // First findMany = this location's photos; second = shared (null-location).
    mockDb.query.organizationPhoto.findMany
      .mockResolvedValueOnce([
        {
          id: 'photo-1',
          organizationId: 'org-1',
          locationId: 'loc-1',
          url: 'https://cdn/1.jpg',
          caption: null,
          sortOrder: 0,
          isCover: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'photo-shared',
          organizationId: 'org-1',
          locationId: null,
          url: 'https://cdn/shared.jpg',
          caption: null,
          sortOrder: 0,
          isCover: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        name: 'Facial',
        description: 'A facial',
        category: 'treatment',
        priceText: 'From €50',
        priceCents: null,
        appointmentDuration: 45,
      },
    ]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      {
        id: 'prac-1',
        name: 'Dr. Jane',
        photo: null,
        title: 'Senior Aesthetician',
        bio: 'Ten years of experience',
      },
    ]);

    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: 'glow-clinic',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organization.name).toBe('Glow Clinic');
      expect(result.data.location.id).toBe('loc-1');
      expect(result.data.location.about).toBe('A lovely clinic');
      expect(result.data.location.amenities).toEqual([
        'free_wifi',
        'parking_available',
      ]);
      expect(result.data.location.addressLine1).toBe('1 Main St');
      // Location opening hours win over org businessHours.
      expect(result.data.location.openingHours).toEqual({
        1: { from: 600, to: 1020 },
      });
      // Branch photos first, then org-wide shared photos.
      expect(result.data.photos.map((p) => p.id)).toEqual([
        'photo-1',
        'photo-shared',
      ]);
      expect(result.data.services[0].priceText).toBe('From €50');
      expect(result.data.team[0].title).toBe('Senior Aesthetician');
    }
  });

  it('resolves a specific branch by locationSlug and falls back to org hours', async () => {
    const branch = {
      ...primaryLocation,
      id: 'loc-2',
      slug: 'south-branch',
      openingHours: null,
    };
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(branch);
    // Both photo queries empty, no services, no team.

    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: 'glow-clinic',
      locationSlug: 'south-branch',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.location.id).toBe('loc-2');
      expect(result.data.location.slug).toBe('south-branch');
      // No location hours → org businessHours.
      expect(result.data.location.openingHours).toEqual({
        1: { from: 540, to: 1080 },
      });
      expect(result.data.photos).toEqual([]);
      expect(result.data.services).toEqual([]);
      expect(result.data.team).toEqual([]);
    }
  });
  it('labels services with the org REAL category name, and null without one', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce(
      primaryLocation
    );
    mockDb.query.organizationServiceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat-1', name: 'Injectables' },
      { id: 'cat-2', name: 'Skin' },
    ]);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        name: 'Lip Filler',
        description: null,
        category: 'treatment',
        categoryId: 'cat-1',
        priceText: null,
        priceType: 'poa',
        priceCents: null,
        appointmentDuration: 30,
      },
      {
        id: 'svc-2',
        name: 'Facial',
        description: null,
        category: 'treatment',
        categoryId: 'cat-2',
        priceText: null,
        priceType: 'poa',
        priceCents: null,
        appointmentDuration: 45,
      },
      // Legacy row with no category assigned. The legacy enum says
      // 'consultation'; it must NOT surface — the org never chose it.
      {
        id: 'svc-3',
        name: 'Consultation',
        description: null,
        category: 'consultation',
        categoryId: null,
        priceText: null,
        priceType: 'poa',
        priceCents: null,
        appointmentDuration: 15,
      },
    ]);

    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: 'glow-clinic',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services.map((s) => s.category)).toEqual([
        'Injectables',
        'Skin',
        null,
      ]);
    }
  });
  it('quotes the BRANCH price, not the org price', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      ...primaryLocation,
      id: 'loc-cork',
      slug: 'cork',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-botox',
        name: 'Botox',
        description: null,
        category: 'treatment',
        priceText: null,
        priceType: 'fixed',
        priceCents: 25000,
        appointmentDuration: 45,
      },
      {
        id: 'svc-facial',
        name: 'Facial',
        description: null,
        category: 'treatment',
        priceText: null,
        priceType: 'fixed',
        priceCents: 8000,
        appointmentDuration: 30,
      },
    ] as never);
    // Only Botox is repriced here. Facial has no join row and must keep the
    // org price rather than falling to null.
    mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce([
      {
        serviceId: 'svc-botox',
        priceCentsOverride: 22000,
        durationMinutesOverride: null,
      },
    ] as never);

    const result = await getVenueConfig(mockDb as never, {
      organizationSlug: 'glow-clinic',
      locationSlug: 'cork',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      const botox = result.data.services.find((s) => s.id === 'svc-botox');
      const facial = result.data.services.find((s) => s.id === 'svc-facial');
      expect(botox?.priceCents).toBe(22000);
      // durationMinutesOverride was NULL = inherit, not "no duration".
      expect(botox?.appointmentDuration).toBe(45);
      expect(facial?.priceCents).toBe(8000);
    }
  });

  it('lists only the practitioners who work at THIS branch', async () => {
    // The page contradicted itself: its services were branch-scoped and its
    // team was org-wide, so a Cork visitor was introduced to a Dublin-only
    // practitioner for a Cork service. The predicate is the shared
    // `atLocationOrUnassigned` one — "assigned here, or assigned nowhere" —
    // so an org that has never assigned anyone is unchanged.
    mockDb.query.organization.findFirst.mockResolvedValueOnce(org);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      ...primaryLocation,
      id: 'loc-cork',
      slug: 'cork',
    });

    await getVenueConfig(mockDb as never, {
      organizationSlug: 'glow-clinic',
      locationSlug: 'cork',
    });

    // The subqueries the predicate builds are the observable evidence that the
    // join table is in the WHERE clause at all.
    const scannedTables = mockDb.from.mock.calls.map((call) => call[0]);
    expect(scannedTables).toContain(practitionerLocation);
  });
});
