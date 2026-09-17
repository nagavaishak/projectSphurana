import { describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import type { WebsiteAnalysisSnapshot } from './apply-website-analysis.schema.js';
import { websiteAnalysisSnapshotSchema } from './apply-website-analysis.schema.js';
import {
  buildWebsiteAnalysisPlan,
  detectCurrencySymbol,
  detectScannedCurrencySymbol,
} from './plan-website-analysis.js';

/**
 * `db.select(...).from(table).where(...)` resolves to whatever the queue holds
 * for that call, in the order the planner reads: services, locations,
 * organization, then (only when scanned) team and packages.
 */
const dbReturning = (...results: unknown[][]) => {
  const queue = [...results];
  return {
    select: vi.fn(() => ({
      from: () => ({ where: () => Promise.resolve(queue.shift() ?? []) }),
    })),
  } as never;
};

const snapshot = (partial: Partial<WebsiteAnalysisSnapshot>) =>
  websiteAnalysisSnapshotSchema.parse(partial);

const service = (name: string, priceType?: string, priceAmount?: number) => ({
  name,
  priceType,
  priceAmount,
});

const existingService = (
  id: string,
  name: string,
  priceType = 'poa',
  priceCents: number | null = null,
  isActive = true
) => ({ id, name, priceType, priceCents, isActive });

describe('scanned currency', () => {
  it('reads the symbol the site published in', () => {
    expect(detectCurrencySymbol('Prices start at £600')).toBe('£');
    expect(detectCurrencySymbol('From €600')).toBe('€');
    expect(detectCurrencySymbol('$1,200 per session')).toBe('$');
  });

  it('prefers a prefixed symbol over the bare one inside it', () => {
    // 'CA$120' contains '$'; returning '$' would relabel Canadian as US.
    expect(detectCurrencySymbol('CA$120')).toBe('CA$');
    expect(detectCurrencySymbol('A$99')).toBe('A$');
  });

  it('returns undefined when the copy carries no symbol', () => {
    expect(detectCurrencySymbol('Price on consultation')).toBeUndefined();
    expect(detectCurrencySymbol('')).toBeUndefined();
    expect(detectCurrencySymbol(null)).toBeUndefined();
  });

  it('takes the majority symbol across the whole scan', () => {
    expect(
      detectScannedCurrencySymbol([
        'From £600',
        '£120',
        'Price on consultation',
        '€90', // a stray euro price does not flip the site's currency
      ])
    ).toBe('£');
  });

  it('is undefined when nothing on the site carried a symbol', () => {
    expect(
      detectScannedCurrencySymbol(['Price on consultation', null, undefined])
    ).toBeUndefined();
  });

  it('puts the site currency on the plan so the diff can show it', async () => {
    const db = dbReturning([], [], []);

    const plan = await buildWebsiteAnalysisPlan(
      db,
      'org_1',
      snapshot({
        services: [
          {
            name: 'Mole Mapping',
            priceType: 'from',
            priceAmount: 600,
            pricingDescription: 'Prices start at £600',
          },
        ],
      }),
      ['services']
    );

    // The org has no locations, so the account currency would fall back to EUR
    // — exactly the onboarding case that showed a UK clinic `€600`.
    expect(plan.scannedCurrencySymbol).toBe('£');
    expect(plan.services.create[0].priceCents).toBe(60_000);
  });

  it('leaves the symbol undefined when the site prices are all POA', async () => {
    const db = dbReturning([], [], []);

    const plan = await buildWebsiteAnalysisPlan(
      db,
      'org_1',
      snapshot({ services: [service('Consultation', 'poa')] }),
      ['services']
    );

    // The client then falls back to the account's own currency.
    expect(plan.scannedCurrencySymbol).toBeUndefined();
  });
});

describe('buildWebsiteAnalysisPlan', () => {
  describe('services', () => {
    it('splits the scan into new, price-changed, unchanged and not-found', async () => {
      const db = dbReturning(
        [
          existingService('svc_1', 'Anti-Wrinkle', 'fixed', 16_000),
          existingService('svc_2', 'Dermaplaning', 'fixed', 5000),
          existingService('svc_3', 'Retired Offer', 'fixed', 1000),
        ],
        [], // locations
        [] // organization
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          services: [
            service('Hydrafacial', 'fixed', 90),
            service('Anti-Wrinkle', 'fixed', 180),
            service('Dermaplaning', 'fixed', 50),
          ],
        }),
        ['services']
      );

      expect(plan.services.create.map((s) => s.name)).toEqual(['Hydrafacial']);
      expect(plan.services.create[0].priceCents).toBe(9000);

      expect(plan.services.priceChanges).toHaveLength(1);
      expect(plan.services.priceChanges[0]).toMatchObject({
        id: 'svc_1',
        name: 'Anti-Wrinkle',
        fromPriceCents: 16_000,
        priceCents: 18_000,
      });

      // Dermaplaning matched at the same price.
      expect(plan.services.unchanged).toBe(1);
      expect(plan.services.notFound.map((s) => s.name)).toEqual([
        'Retired Offer',
      ]);
    });

    it('matches names case- and whitespace-insensitively', async () => {
      const db = dbReturning(
        [existingService('svc_1', 'Anti-Wrinkle', 'fixed', 16_000)],
        [],
        []
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({ services: [service('  anti-wrinkle  ', 'fixed', 160)] }),
        ['services']
      );

      expect(plan.services.create).toEqual([]);
      expect(plan.services.notFound).toEqual([]);
      expect(plan.services.unchanged).toBe(1);
    });

    it('never proposes overwriting a real price with an unreadable one', async () => {
      const db = dbReturning(
        [existingService('svc_1', 'Anti-Wrinkle', 'fixed', 16_000)],
        [],
        []
      );

      // The scan found the service but could not read a price.
      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({ services: [service('Anti-Wrinkle', 'poa')] }),
        ['services']
      );

      expect(plan.services.priceChanges).toEqual([]);
      expect(plan.services.unchanged).toBe(1);
    });

    it('leaves already-inactive services out of notFound', async () => {
      const db = dbReturning(
        [existingService('svc_1', 'Old Thing', 'fixed', 1000, false)],
        [],
        []
      );

      const plan = await buildWebsiteAnalysisPlan(db, 'org_1', snapshot({}), [
        'services',
      ]);

      expect(plan.services.notFound).toEqual([]);
    });

    it('proposes nothing for a section that was not scanned', async () => {
      const db = dbReturning(
        [existingService('svc_1', 'Anti-Wrinkle', 'fixed', 16_000)],
        [],
        []
      );

      // Scanned for hours only — the untouched catalog must not read as
      // "none of your services are on your website".
      const plan = await buildWebsiteAnalysisPlan(db, 'org_1', snapshot({}), [
        'hours',
      ]);

      expect(plan.services.notFound).toEqual([]);
      expect(plan.services.create).toEqual([]);
      expect(plan.scanned).toEqual(['hours']);
    });
  });

  describe('venue description (ENG-645)', () => {
    it('targets the primary location and reports the current text', async () => {
      const db = dbReturning(
        [],
        [
          {
            id: 'loc_1',
            addressLine1: '1 Main St',
            about: null,
            isPrimary: false,
          },
          {
            id: 'loc_2',
            addressLine1: '2 High St',
            about: 'Existing about text',
            isPrimary: true,
          },
        ],
        []
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({ businessDescription: 'A calm clinic in the city centre.' }),
        ['description']
      );

      expect(plan.description).toEqual({
        locationId: 'loc_2',
        current: 'Existing about text',
        scanned: 'A calm clinic in the city centre.',
      });
    });

    it('reports no scanned description when the site said too little', async () => {
      const db = dbReturning(
        [],
        [
          {
            id: 'loc_1',
            addressLine1: '1 Main St',
            about: null,
            isPrimary: true,
          },
        ],
        []
      );

      const plan = await buildWebsiteAnalysisPlan(db, 'org_1', snapshot({}), [
        'description',
      ]);

      expect(plan.description.scanned).toBeNull();
    });
  });

  describe('locations', () => {
    it('matches an existing address despite punctuation differences', async () => {
      const db = dbReturning(
        [],
        [
          {
            id: 'loc_1',
            addressLine1: '12 High-Street',
            about: null,
            isPrimary: true,
          },
        ],
        []
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          locations: [
            { addressLine1: '12 High Street', city: 'Dublin', country: 'IE' },
          ],
        }),
        ['location']
      );

      expect(plan.locations.create).toEqual([]);
      expect(plan.locations.matched).toBe(1);
    });

    it('blocks an address whose country is not a real country code', async () => {
      const db = dbReturning([], [], []);

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          locations: [
            { addressLine1: '1 Main St', city: 'Dublin', country: 'Ireland' },
          ],
        }),
        ['location']
      );

      expect(plan.locations.create).toEqual([]);
      expect(plan.locations.blocked).toHaveLength(1);
      expect(plan.locations.blocked[0].reason).toContain('Ireland');
    });
  });

  describe('packages', () => {
    it('resolves items against services this same apply will create', async () => {
      const db = dbReturning(
        [], // no services yet
        [],
        [],
        [], // team (not scanned, but the queue is positional)
        [] // packages
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          services: [service('Laser Full Body', 'fixed', 285)],
          packages: [
            {
              name: 'Course of 6',
              priceAmount: 1425,
              serviceNames: ['Laser Full Body'],
            },
          ],
        }),
        ['packages']
      );

      expect(plan.packages.blocked).toEqual([]);
      expect(plan.packages.create).toHaveLength(1);
      expect(plan.packages.create[0]).toMatchObject({
        name: 'Course of 6',
        priceCents: 142_500,
      });
    });

    it('blocks a package naming a service that does not and will not exist', async () => {
      const db = dbReturning([], [], [], [], []);

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          services: [service('Laser Full Body', 'fixed', 285)],
          packages: [
            {
              name: 'Mystery Bundle',
              priceAmount: 500,
              serviceNames: ['Something We Never Saw'],
            },
          ],
        }),
        ['packages']
      );

      expect(plan.packages.create).toEqual([]);
      expect(plan.packages.blocked[0].reason).toContain(
        'Something We Never Saw'
      );
    });

    it('blocks a package with no items rather than selling an empty bundle', async () => {
      const db = dbReturning([], [], [], [], []);

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          packages: [
            { name: 'Bridal Package', priceAmount: 300, serviceNames: [] },
          ],
        }),
        ['packages']
      );

      expect(plan.packages.create).toEqual([]);
      expect(plan.packages.blocked).toHaveLength(1);
    });
  });

  describe('team', () => {
    it('separates new staff from the ones already on the account', async () => {
      const db = dbReturning(
        [],
        [],
        [],
        [
          { id: 'p_1', name: 'Aoife Byrne', isActive: true },
          { id: 'p_2', name: 'Former Staffer', isActive: true },
        ]
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({
          practitioners: [
            { name: 'aoife byrne' },
            { name: 'Niamh Kelly', title: 'Aesthetic Nurse' },
          ],
        }),
        ['team']
      );

      expect(plan.team.create).toEqual([
        {
          key: 'team.create:niamh kelly',
          name: 'Niamh Kelly',
          title: 'Aesthetic Nurse',
          email: undefined,
        },
      ]);
      expect(plan.team.notFound.map((p) => p.name)).toEqual(['Former Staffer']);
    });
  });

  describe('hours', () => {
    it('reports current and scanned hours side by side', async () => {
      const db = dbReturning(
        [],
        [],
        [{ businessHours: { '1': { from: 540, to: 1020 } } }]
      );

      const plan = await buildWebsiteAnalysisPlan(
        db,
        'org_1',
        snapshot({ businessHours: { '1': { from: 600, to: 1080 } } }),
        ['hours']
      );

      expect(plan.hours.current).toEqual({ '1': { from: 540, to: 1020 } });
      expect(plan.hours.scanned).toEqual({ '1': { from: 600, to: 1080 } });
    });
  });
});
