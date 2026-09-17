import { practitionerLocation } from '@borradh-workspace/database';
import { createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { getGeneralBookingConfig } from './get-general-booking-config.service.js';

describe('getGeneralBookingConfig', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    mockDb._resetMocks();
  });

  const validInput = { organizationSlug: 'test-salon' };

  it('returns config with services for valid org', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      logo: 'https://example.com/logo.png',
    });

    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        name: 'Haircut',
        pricingDescription: '€30',
        appointmentDuration: 30,
        description: 'A classic haircut',
        paymentPolicy: null,
        depositBasis: null,
        depositAmountCents: null,
        depositPercent: null,
      },
      {
        id: 'svc-2',
        name: 'Facial',
        pricingDescription: '€50',
        appointmentDuration: 60,
        description: null,
        paymentPolicy: 'deposit',
        depositBasis: 'fixed',
        depositAmountCents: 2000,
        depositPercent: null,
      },
    ]);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.organizationName).toBe('Test Salon');
      expect(result.data.organizationSlug).toBe('test-salon');
      expect(result.data.organizationLogo).toBe('https://example.com/logo.png');
      expect(result.data.services).toHaveLength(2);
      expect(result.data.services[0].name).toBe('Haircut');
      // The page resolves what's due itself, so the config has to hand it the
      // resolver's inputs — a service's own policy, and the org defaults an
      // unset one inherits. Shipping a bare boolean is what let the button and
      // the charge drift apart.
      expect(result.data.services[1].payment).toEqual({
        paymentPolicy: 'deposit',
        depositBasis: 'fixed',
        depositAmountCents: 2000,
        depositPercent: null,
      });
      expect(result.data.services[0].payment.paymentPolicy).toBeNull();
      expect(result.data.paymentDefaults).toEqual({
        defaultPaymentPolicy: 'in_clinic',
        defaultDepositBasis: 'fixed',
        defaultDepositAmountCents: null,
        defaultDepositPercent: null,
        depositAggregation: 'sum',
      });
    }
  });

  it('gates the org default amount on the legacy toggle, as the charge path does', async () => {
    // `deposit_amount` has no separate "default amount" column, so it is only a
    // default while `deposit_enabled` is on. An org that switched deposits off
    // and left the figure behind must not have it picked back up — the config
    // maps this through the same adapter submit-general-booking charges by.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      depositEnabled: false,
      depositAmount: 2000,
      defaultPaymentPolicy: 'in_clinic',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Consultation', appointmentDuration: 30 },
    ]);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.paymentDefaults.defaultDepositAmountCents).toBeNull();
    }
  });

  it('displays the Stripe account currency (what is charged), not the country currency', async () => {
    // Irish org (country 'ie' → EUR) whose Stripe Connect account settles in
    // GBP. The deposit is CHARGED in GBP, so the widget must display GBP — the
    // old behaviour showed EUR from the country and mislabelled the charge.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Irish Clinic',
      slug: 'test-salon',
      depositEnabled: true,
      depositAmount: 5000,
    });
    mockDb.query.stripeConnectIntegration.findFirst.mockResolvedValueOnce({
      defaultCurrency: 'gbp',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Consultation', appointmentDuration: 30 },
    ]);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      country: 'ie',
    });

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toEqual({ code: 'GBP', symbol: '£' });
    }
  });

  it('falls back to the country currency when the org has no Stripe integration', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Irish Clinic',
      slug: 'test-salon',
    });
    // No stripeConnectIntegration mock → findFirst resolves undefined.
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Consultation', appointmentDuration: 30 },
    ]);
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      country: 'ie',
    });

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.currency).toEqual({ code: 'EUR', symbol: '€' });
    }
  });

  it('scopes each practitioner to the services they are assigned to', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      logo: null,
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Haircut', appointmentDuration: 30 },
      { id: 'svc-2', name: 'Facial', appointmentDuration: 60 },
    ]);
    mockDb.query.practitioner.findMany.mockResolvedValueOnce([
      { id: 'prac-1', name: 'Assigned', photo: null, title: null },
      { id: 'prac-2', name: 'Unassigned', photo: null, title: null },
    ]);
    // prac-1 does svc-1 only; prac-2 has no service links.
    mockDb.query.practitionerService.findMany.mockResolvedValueOnce([
      { practitionerId: 'prac-1', serviceId: 'svc-1' },
    ]);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      const [assigned, unassigned] = result.data.practitioners;
      expect(assigned.serviceIds).toEqual(['svc-1']);
      expect(unassigned.serviceIds).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR for empty slug', async () => {
    const result = await getGeneralBookingConfig(mockDb as never, {
      organizationSlug: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(null);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Organization not found');
    }
  });

  it('returns NOT_FOUND when no active services exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      logo: null,
    });

    mockDb.query.organizationService.findMany.mockResolvedValueOnce([]);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toContain('No active services');
    }
  });
  it('labels services with the org REAL category name, and null without one', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      logo: null,
    });
    mockDb.query.organizationServiceCategory.findMany.mockResolvedValueOnce([
      { id: 'cat-1', name: 'Hair' },
    ]);
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        name: 'Haircut',
        category: 'treatment',
        categoryId: 'cat-1',
        appointmentDuration: 30,
      },
      // No category row → null. The legacy enum's 'consultation' must not leak.
      {
        id: 'svc-2',
        name: 'Chat',
        category: 'consultation',
        categoryId: null,
        appointmentDuration: 15,
      },
    ]);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services.map((s) => s.category)).toEqual([
        'Hair',
        null,
      ]);
    }
  });
  it('quotes the default branch price on the general form', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      logo: null,
    });
    // Default branch resolves first (it now gates the service query too).
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-primary',
      country: 'IE',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        name: 'Haircut',
        priceType: 'fixed',
        priceCents: 3000,
        appointmentDuration: 30,
        description: null,
        paymentPolicy: null,
        depositBasis: null,
        depositAmountCents: null,
        depositPercent: null,
      },
    ] as never);
    mockDb.query.organizationServiceLocation.findMany.mockResolvedValueOnce([
      {
        serviceId: 'svc-1',
        priceCentsOverride: 3500,
        durationMinutesOverride: 45,
      },
    ] as never);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services[0].priceCents).toBe(3500);
      expect(result.data.services[0].appointmentDuration).toBe(45);
    }
  });

  it('does not look for overrides when the org has no locations', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
      logo: null,
    });
    // No default branch resolves — an org mid-onboarding. The form must still
    // work at org prices rather than erroring or blanking the catalogue.
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      {
        id: 'svc-1',
        name: 'Haircut',
        priceType: 'fixed',
        priceCents: 3000,
        appointmentDuration: 30,
        description: null,
        paymentPolicy: null,
        depositBasis: null,
        depositAmountCents: null,
        depositPercent: null,
      },
    ] as never);

    const result = await getGeneralBookingConfig(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.services[0].priceCents).toBe(3000);
    expect(
      mockDb.query.organizationServiceLocation.findMany
    ).not.toHaveBeenCalled();
  });

  it('lists only the practitioners who work at the branch being booked', async () => {
    // Services on this page are branch-scoped and the team was not, so the
    // wizard offered a Dublin-only practitioner for a Cork service. Same
    // `atLocationOrUnassigned` predicate as the dashboard's own list — zero
    // `practitioner_location` rows still means every branch.
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org-1',
      name: 'Test Salon',
      slug: 'test-salon',
    });
    mockDb.query.organizationLocation.findFirst.mockResolvedValueOnce({
      id: 'loc-cork',
      slug: 'cork',
      country: 'ie',
    });
    mockDb.query.organizationService.findMany.mockResolvedValueOnce([
      { id: 'svc-1', name: 'Haircut', appointmentDuration: 30 },
    ]);

    await getGeneralBookingConfig(mockDb as never, {
      organizationSlug: 'test-salon',
      locationSlug: 'cork',
    });

    // The subqueries the predicate builds are the observable evidence that the
    // join table is in the WHERE clause at all.
    const scannedTables = mockDb.from.mock.calls.map((call) => call[0]);
    expect(scannedTables).toContain(practitionerLocation);
  });
});
