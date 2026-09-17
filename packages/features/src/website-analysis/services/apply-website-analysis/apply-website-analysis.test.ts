import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
// Spy the SOURCE modules, not the barrels — barrel re-exports are live getters
// and `vi.spyOn` cannot redefine them. (Same reason as the onboarding suite.)
import * as createLocationModule from '../../../organization-locations/services/create-location/create-location.service.js';
import * as createServiceModule from '../../../organization-services/services/create-service/create-service.service.js';
import * as updateServiceModule from '../../../organization-services/services/update-service/update-service.service.js';
import * as updateOrgSettingsModule from '../../../organizations/services/update-organization-settings/update-organization-settings.service.js';
import * as createPackageModule from '../../../packages/services/create-package/create-package.service.js';
import * as createPractitionerModule from '../../../practitioners/services/create-practitioner/create-practitioner.service.js';
import * as updatePractitionerModule from '../../../practitioners/services/update-practitioner/update-practitioner.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as updateVenueModule from '../../../venue/services/update-location-venue/update-location-venue.service.js';
import { applyWebsiteAnalysis } from './apply-website-analysis.service.js';

const ok = (data: unknown) => ({ success: true, data }) as never;

/** Positional read queue — services, locations, organization, team, packages. */
const dbReturning = (...results: unknown[][]) => {
  const queue = [...results];
  return {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve(queue.shift() ?? []) }),
    })),
  } as never;
};

let createService: MockInstance;
let updateService: MockInstance;
let createLocation: MockInstance;
let createPractitioner: MockInstance;
let updatePractitioner: MockInstance;
let createPackage: MockInstance;
let updateOrgSettings: MockInstance;
let updateVenue: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  createService = vi
    .spyOn(createServiceModule, 'createService')
    .mockResolvedValue(ok({ id: 'svc_new' }));
  updateService = vi
    .spyOn(updateServiceModule, 'updateService')
    .mockResolvedValue(ok({ id: 'svc_1' }));
  createLocation = vi
    .spyOn(createLocationModule, 'createLocation')
    .mockResolvedValue(ok({ id: 'loc_new' }));
  createPractitioner = vi
    .spyOn(createPractitionerModule, 'createPractitioner')
    .mockResolvedValue(ok({ id: 'p_new' }));
  updatePractitioner = vi
    .spyOn(updatePractitionerModule, 'updatePractitioner')
    .mockResolvedValue(ok({ id: 'p_1' }));
  createPackage = vi
    .spyOn(createPackageModule, 'createPackage')
    .mockResolvedValue(ok({ id: 'pkg_new' }));
  updateOrgSettings = vi
    .spyOn(updateOrgSettingsModule, 'updateOrganizationSettings')
    .mockResolvedValue(ok({ id: 'org_1' }));
  updateVenue = vi
    .spyOn(updateVenueModule, 'updateLocationVenue')
    .mockResolvedValue(ok({ id: 'loc_1' }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyWebsiteAnalysis', () => {
  it('returns VALIDATION_ERROR without an organization', async () => {
    const result = await applyWebsiteAnalysis(dbReturning(), {
      organizationId: '',
      analysis: {},
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('creates the services a scan found that the account lacks', async () => {
    const result = await applyWebsiteAnalysis(
      dbReturning([], [], [], [], [], []),
      {
        organizationId: 'org_1',
        analysis: {
          services: [
            { name: 'Hydrafacial', priceType: 'fixed', priceAmount: 90 },
          ],
        },
        scanFor: ['services'],
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdServiceIds).toEqual(['svc_new']);
    }
    expect(createService).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        name: 'Hydrafacial',
        priceType: 'fixed',
        priceCents: 9000,
      })
    );
  });

  describe('replace mode', () => {
    const existing = [
      {
        id: 'svc_stale',
        name: 'Retired Offer',
        priceType: 'fixed',
        priceCents: 1000,
        isActive: true,
      },
    ];

    it('DEACTIVATES what the scan did not find — it never deletes', async () => {
      const result = await applyWebsiteAnalysis(
        // The plan reads the catalog, then the executor re-reads it.
        dbReturning(existing, [], [], [], [], existing),
        {
          organizationId: 'org_1',
          analysis: { services: [] },
          scanFor: ['services'],
          modes: { services: 'replace' },
        }
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.servicesDeactivated).toBe(1);
      expect(updateService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'svc_stale', isActive: false })
      );
    });

    it('leaves them alone in add mode', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning(existing, [], [], [], [], existing),
        {
          organizationId: 'org_1',
          analysis: { services: [] },
          scanFor: ['services'],
          modes: { services: 'add' },
        }
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.servicesDeactivated).toBe(0);
      expect(updateService).not.toHaveBeenCalled();
    });

    it('defaults to add — an apply with no modes removes nothing', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning(existing, [], [], [], [], existing),
        {
          organizationId: 'org_1',
          analysis: { services: [] },
          scanFor: ['services'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.servicesDeactivated).toBe(0);
    });

    it('deactivates staff the scan did not find', async () => {
      const staff = [{ id: 'p_gone', name: 'Former Staffer', isActive: true }];
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], staff, [], []),
        {
          organizationId: 'org_1',
          analysis: { practitioners: [] },
          scanFor: ['team'],
          modes: { team: 'replace' },
        }
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.practitionersDeactivated).toBe(1);
      expect(updatePractitioner).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ id: 'p_gone', isActive: false })
      );
    });
  });

  describe('ignore mode', () => {
    it('writes nothing at all for that section', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            services: [
              { name: 'Hydrafacial', priceType: 'fixed', priceAmount: 90 },
            ],
          },
          scanFor: ['services'],
          modes: { services: 'ignore' },
        }
      );

      expect(result.success).toBe(true);
      expect(createService).not.toHaveBeenCalled();
    });
  });

  describe('venue description (ENG-645)', () => {
    it('writes the scanned description onto the primary venue', async () => {
      const locations = [
        {
          id: 'loc_1',
          addressLine1: '1 Main St',
          about: null,
          isPrimary: true,
        },
      ];
      const result = await applyWebsiteAnalysis(
        dbReturning([], locations, [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: { businessDescription: 'A calm clinic.' },
          scanFor: ['description'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success)
        expect(result.data.venueDescriptionUpdated).toBe(true);
      expect(updateVenue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          locationId: 'loc_1',
          about: 'A calm clinic.',
        })
      );
    });

    it('keeps the existing description when the owner chose to', async () => {
      const locations = [
        {
          id: 'loc_1',
          addressLine1: '1 Main St',
          about: 'Hand-written copy',
          isPrimary: true,
        },
      ];
      const result = await applyWebsiteAnalysis(
        dbReturning([], locations, [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: { businessDescription: 'A calm clinic.' },
          scanFor: ['description'],
          modes: { description: 'ignore' },
        }
      );

      expect(result.success).toBe(true);
      expect(updateVenue).not.toHaveBeenCalled();
    });

    it('lands on a location created in the same apply', async () => {
      // The onboarding case: the org has no venue yet when the plan is built.
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            businessDescription: 'A calm clinic.',
            locations: [
              { addressLine1: '1 Main St', city: 'Dublin', country: 'ie' },
            ],
          },
          scanFor: ['description', 'location'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.locationsCreated).toBe(1);
        expect(result.data.venueDescriptionUpdated).toBe(true);
      }
      // The new venue is the org's first, so it becomes primary.
      expect(createLocation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ addressLine1: '1 Main St', isPrimary: true })
      );
      expect(updateVenue).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ locationId: 'loc_new' })
      );
    });

    it('reports the gap when there is nowhere to write it', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: { businessDescription: 'A calm clinic.' },
          scanFor: ['description'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.venueDescriptionUpdated).toBe(false);
        expect(result.data.skipped.join(' ')).toContain('add a location first');
      }
    });
  });

  describe('staff emails', () => {
    it('mints an undeliverable placeholder when the site publishes none', async () => {
      await applyWebsiteAnalysis(dbReturning([], [], [], [], [], []), {
        organizationId: 'org_1',
        analysis: { practitioners: [{ name: 'Aoife Byrne' }] },
        scanFor: ['team'],
      });

      expect(createPractitioner).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Aoife Byrne',
          email: 'aoife.byrne@scraped.invalid',
        })
      );
    });

    it('uses a real published address when there is one', async () => {
      await applyWebsiteAnalysis(dbReturning([], [], [], [], [], []), {
        organizationId: 'org_1',
        analysis: {
          practitioners: [{ name: 'Aoife Byrne', email: 'aoife@clinic.ie' }],
        },
        scanFor: ['team'],
      });

      expect(createPractitioner).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ email: 'aoife@clinic.ie' })
      );
    });

    it('keeps placeholders unique — the column is unique per org', async () => {
      await applyWebsiteAnalysis(dbReturning([], [], [], [], [], []), {
        organizationId: 'org_1',
        analysis: {
          practitioners: [{ name: 'Aoife Byrne' }, { name: 'aoife  byrne!' }],
        },
        scanFor: ['team'],
      });

      const emails = createPractitioner.mock.calls.map(
        (call) => (call[1] as { email: string }).email
      );
      expect(new Set(emails).size).toBe(emails.length);
    });
  });

  describe('packages', () => {
    it('resolves items against services created in the same run', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            services: [
              { name: 'Laser Full Body', priceType: 'fixed', priceAmount: 285 },
            ],
            packages: [
              {
                name: 'Course of 6',
                priceAmount: 1425,
                serviceNames: ['Laser Full Body'],
              },
            ],
          },
          scanFor: ['packages'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.packagesCreated).toBe(1);
      expect(createPackage).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          name: 'Course of 6',
          priceCents: 142_500,
          items: [{ serviceId: 'svc_new', quantity: 1, sortOrder: 0 }],
        })
      );
    });

    it('never creates a bundle whose service failed to insert', async () => {
      createService.mockResolvedValue({
        success: false,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: 'boom' },
      } as never);

      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            services: [
              { name: 'Laser Full Body', priceType: 'fixed', priceAmount: 285 },
            ],
            packages: [
              {
                name: 'Course of 6',
                priceAmount: 1425,
                serviceNames: ['Laser Full Body'],
              },
            ],
          },
          scanFor: ['packages'],
        }
      );

      expect(result.success).toBe(true);
      expect(createPackage).not.toHaveBeenCalled();
      if (result.success) {
        expect(result.data.skipped.join(' ')).toContain('Course of 6');
      }
    });
  });

  describe('opening hours and brand', () => {
    it('writes both in a single settings update', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [{ businessHours: null }], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            businessHours: { '1': { from: 540, to: 1020 } },
            primaryColor: '#aa33bb',
            logoUrl: 'https://clinic.ie/logo.png',
          },
          scanFor: ['hours', 'brand'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.openingHoursUpdated).toBe(true);
        expect(result.data.brandUpdated).toBe(true);
      }
      expect(updateOrgSettings).toHaveBeenCalledTimes(1);
      expect(updateOrgSettings).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          businessHours: { '1': { from: 540, to: 1020 } },
          primaryColor: '#aa33bb',
          logo: 'https://clinic.ie/logo.png',
        })
      );
    });

    it('writes nothing when the section was not scanned', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [{ businessHours: null }], [], [], []),
        {
          organizationId: 'org_1',
          analysis: { businessHours: { '1': { from: 540, to: 1020 } } },
          scanFor: ['services'],
        }
      );

      expect(result.success).toBe(true);
      expect(updateOrgSettings).not.toHaveBeenCalled();
    });
  });

  it('keeps going and reports the gap when one row fails', async () => {
    createService
      .mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.ALREADY_EXISTS, message: 'dup' },
      } as never)
      .mockResolvedValueOnce(ok({ id: 'svc_2' }));

    const result = await applyWebsiteAnalysis(
      dbReturning([], [], [], [], [], []),
      {
        organizationId: 'org_1',
        analysis: {
          services: [{ name: 'First' }, { name: 'Second' }],
        },
        scanFor: ['services'],
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.createdServiceIds).toEqual(['svc_2']);
      expect(result.data.skipped.join(' ')).toContain('First');
    }
  });

  /**
   * Per-row selection (ENG-659). The review step lets the owner drop an
   * individual scraped row — a real site yields ~60 services and a handful are
   * SEO page titles — so these cover that a deselected key is honoured, that an
   * unknown key is inert, and that dropping a service a package needs blocks
   * the package rather than creating an empty bundle.
   */
  describe('deselection', () => {
    it('never creates a service the owner un-ticked', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            services: [
              { name: 'Hydrafacial', priceType: 'fixed', priceAmount: 90 },
              { name: 'Laser Hair Removal Stoke', priceType: 'poa' },
            ],
          },
          scanFor: ['services'],
          deselected: ['service.create:laser hair removal stoke'],
        }
      );

      expect(result.success).toBe(true);
      expect(createService).toHaveBeenCalledTimes(1);
      expect(createService).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: 'Hydrafacial' })
      );
    });

    it('leaves a not-found row active when its key is un-ticked, even in replace mode', async () => {
      const existing = [
        {
          id: 'svc_stale',
          name: 'Retired Offer',
          priceType: 'fixed',
          priceCents: 1000,
          isActive: true,
        },
      ];

      const result = await applyWebsiteAnalysis(
        dbReturning(existing, [], [], [], [], existing),
        {
          organizationId: 'org_1',
          analysis: { services: [] },
          scanFor: ['services'],
          modes: { services: 'replace' },
          deselected: ['service.deactivate:svc_stale'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) expect(result.data.servicesDeactivated).toBe(0);
      expect(updateService).not.toHaveBeenCalled();
    });

    it('treats a key that matches no row as inert', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            services: [
              { name: 'Hydrafacial', priceType: 'fixed', priceAmount: 90 },
            ],
          },
          scanFor: ['services'],
          deselected: ['service.create:something that moved on'],
        }
      );

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.createdServiceIds).toEqual(['svc_new']);
      }
    });

    it('blocks a package whose service the owner un-ticked, rather than bundling nothing', async () => {
      const result = await applyWebsiteAnalysis(
        dbReturning([], [], [], [], [], []),
        {
          organizationId: 'org_1',
          analysis: {
            services: [
              { name: 'Emsculpt Toning', priceType: 'fixed', priceAmount: 85 },
            ],
            packages: [
              {
                name: 'Emsculpt Toning - 4 Sessions',
                priceAmount: 250,
                serviceNames: ['Emsculpt Toning'],
              },
            ],
          },
          scanFor: ['services', 'packages'],
          deselected: ['service.create:emsculpt toning'],
        }
      );

      expect(result.success).toBe(true);
      expect(createService).not.toHaveBeenCalled();
      expect(createPackage).not.toHaveBeenCalled();
      if (result.success) {
        expect(result.data.packagesCreated).toBe(0);
        expect(result.data.skipped.join(' ')).toContain(
          'Emsculpt Toning - 4 Sessions'
        );
      }
    });
  });
});
