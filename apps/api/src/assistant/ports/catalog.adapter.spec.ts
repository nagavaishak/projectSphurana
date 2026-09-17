// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import { createCatalogPort } from './catalog.adapter.js';

type Routes = Partial<Record<'services' | 'packages' | 'memberships', unknown>>;

/**
 * `apiFetch` stub serving the three catalogue reads, or throwing for any route
 * whose key is listed — which is how a source is made unreadable.
 */
function stub(routes: Routes, throwFor: (keyof Routes)[] = [], status = 500) {
  const fn = (async (pathArg: string) => {
    const key: keyof Routes = pathArg.startsWith('organization-services')
      ? 'services'
      : pathArg.startsWith('packages')
        ? 'packages'
        : 'memberships';
    if (throwFor.includes(key)) throw new ApiFetchError(`boom: ${key}`, status);
    return (
      routes[key] ??
      (key === 'services' ? { items: [], total: 0, limit: 100, offset: 0 } : [])
    );
  }) as unknown as ApiFetchFn;
  return fn;
}

const service = (over: Record<string, unknown> = {}) => ({
  id: 'svc-1',
  organizationId: 'org-1',
  name: 'Facial',
  description: null,
  category: 'facial',
  categoryId: null,
  sortOrder: 0,
  isCustom: false,
  isActive: true,
  requiresDeposit: false,
  depositAmountCents: null,
  depositLink: null,
  stripePaymentLinkId: null,
  stripeProductId: null,
  painPoints: null,
  expectedResults: null,
  processDescription: null,
  targetArea: null,
  priceText: null,
  priceType: 'fixed',
  priceCents: 7000,
  appointmentDuration: 60,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  hasGraphicMedia: false,
  hasVideoFootage: false,
  variants: [],
  ...over,
});

const servicesResponse = (items: unknown[]) => ({
  items,
  total: items.length,
  limit: 100,
  offset: 0,
});

const pkg = (over: Record<string, unknown> = {}) => ({
  id: 'pkg-1',
  organizationId: 'org-1',
  name: 'Course of six',
  description: null,
  categoryId: null,
  priceCents: 36_000,
  validityDays: 180,
  requiresDeposit: false,
  depositAmountCents: null,
  depositLink: null,
  stripePaymentLinkId: null,
  stripeProductId: null,
  sortOrder: 0,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  items: [
    {
      id: 'pi-1',
      packageId: 'pkg-1',
      serviceId: 'svc-1',
      quantity: 6,
      sortOrder: 0,
      createdAt: '2026-01-01T00:00:00.000Z',
      service: service(),
    },
  ],
  ...over,
});

const plan = (over: Record<string, unknown> = {}) => ({
  id: 'mp-1',
  organizationId: 'org-1',
  name: 'Glow Club',
  description: null,
  sessionCount: 1,
  pricingType: 'recurring',
  validFor: '1m',
  priceCents: 6000,
  currency: 'EUR',
  stripeProductId: null,
  stripePriceId: null,
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  serviceIds: ['svc-1'],
  ...over,
});

describe('catalog port', () => {
  it('returns all three kinds in one comparable list', async () => {
    const port = createCatalogPort({
      apiFetch: stub({
        services: servicesResponse([service()]),
        packages: [pkg()],
        memberships: [plan()],
      }),
    });

    const result = await port.listSellables({});

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.sellables.map((s) => s.kind)).toEqual([
      'service',
      'package',
      'membership',
    ]);
    expect(result.read).toEqual(['services', 'packages', 'memberships']);
  });

  it('an unreadable source makes the result `partially_read`, never `read`', async () => {
    // THE load-bearing property. Services and memberships come back clean;
    // packages faults. Presenting the rest as the price list is the exact
    // failure this port exists to prevent — the better product is never
    // offered and nobody learns the sale was lost.
    const port = createCatalogPort({
      apiFetch: stub(
        {
          services: servicesResponse([service()]),
          memberships: [plan()],
        },
        ['packages']
      ),
    });

    const result = await port.listSellables({});

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.unread).toEqual(['packages']);
    expect(result.read).toEqual(['services', 'memberships']);
    // There is no member in which an unread source coexists with a complete
    // catalogue, so a consumer cannot phrase this as "that's everything".
    expect(result).not.toHaveProperty('status', 'read');
  });

  it('keeps the three pricing models distinct rather than one price number', async () => {
    const port = createCatalogPort({
      apiFetch: stub({
        services: servicesResponse([service()]),
        packages: [pkg()],
        memberships: [plan()],
      }),
    });

    const result = await port.listSellables({});
    if (result.status === 'blocked') throw new Error('expected a read');

    const [svc, bundle, membership] = result.sellables;
    expect(svc.price).toEqual({ model: 'one_off', amountCents: 7000 });
    expect(bundle.price).toEqual({
      model: 'bundle',
      amountCents: 36_000,
      itemCount: 6,
      validityDays: 180,
    });
    // €60 a MONTH, not €60 — the period lives in the same object as the
    // amount so it cannot be quoted without it.
    expect(membership.price).toEqual({
      model: 'recurring',
      amountCents: 6000,
      sessionCount: 1,
      period: '1m',
      periodLabel: '1 month',
    });
  });

  it('a one-time membership is prepaid_term, not a recurring charge', async () => {
    const port = createCatalogPort({
      apiFetch: stub({
        memberships: [plan({ pricingType: 'one_time', validFor: '3m' })],
      }),
    });

    const result = await port.listSellables({ kinds: ['membership'] });
    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.sellables[0].price).toEqual({
      model: 'prepaid_term',
      amountCents: 6000,
      sessionCount: 1,
      term: '3m',
      termLabel: '3 months',
    });
  });

  it('a priced service with no amount is `unpriced`, never free', async () => {
    // A model told a treatment is free will say so out loud, and the business
    // has to honour it.
    const port = createCatalogPort({
      apiFetch: stub({
        services: servicesResponse([
          service({ priceCents: null, priceText: '€70-ish' }),
          service({ id: 'svc-2', priceType: 'poa', priceCents: null }),
          service({ id: 'svc-3', priceType: 'from', priceCents: 5000 }),
        ]),
      }),
    });

    const result = await port.listSellables({ kinds: ['service'] });
    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.sellables.map((s) => s.price)).toEqual([
      { model: 'unpriced', declaredType: 'fixed', legacyText: '€70-ish' },
      { model: 'on_consultation' },
      { model: 'from', fromAmountCents: 5000 },
    ]);
  });

  it('hides inactive items unless asked, because they are not on sale', async () => {
    const routes = {
      services: servicesResponse([service({ isActive: false })]),
      packages: [pkg({ isActive: false })],
      memberships: [plan({ isActive: false })],
    };

    const hidden = await createCatalogPort({
      apiFetch: stub(routes),
    }).listSellables({});
    if (hidden.status === 'blocked') throw new Error('expected a read');
    expect(hidden.sellables).toEqual([]);

    const shown = await createCatalogPort({
      apiFetch: stub(routes),
    }).listSellables({ includeInactive: true });
    if (shown.status === 'blocked') throw new Error('expected a read');
    expect(shown.sellables).toHaveLength(3);
  });

  it('when every requested source fails it is `blocked` — nothing was learned', async () => {
    const port = createCatalogPort({
      apiFetch: stub({}, ['services', 'packages', 'memberships']),
    });

    const result = await port.listSellables({});

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('server_error');
  });

  it('a 4xx is a stated reason, not a server fault', async () => {
    const port = createCatalogPort({
      apiFetch: stub({}, ['services', 'packages', 'memberships'], 404),
    });

    const result = await port.listSellables({});
    if (result.status !== 'blocked') throw new Error('expected blocked');
    // Only the fault side may page someone.
    expect(result.reason.kind).toBe('other');
  });

  it('refuses an empty `kinds` without calling anything', async () => {
    // An empty selection must not read as "nothing is for sale".
    const apiFetch = jest.fn();
    const port = createCatalogPort({
      apiFetch: apiFetch as unknown as ApiFetchFn,
    });

    const result = await port.listSellables({ kinds: [] });

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('invalid_input');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('narrowing to one kind does not mark the others unread', async () => {
    // `unread` means "I tried and failed", not "I did not ask" — otherwise a
    // narrowed read would look permanently incomplete.
    const port = createCatalogPort({
      apiFetch: stub({ packages: [pkg()] }, ['services', 'memberships']),
    });

    const result = await port.listSellables({ kinds: ['package'] });

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.read).toEqual(['packages']);
  });

  it('counts bundle sessions, not distinct services', async () => {
    // "Six treatments for €360" is what makes the bundle comparable against
    // the single-visit price; "one service" does not.
    const port = createCatalogPort({
      apiFetch: stub({
        packages: [
          pkg({
            items: [
              { ...pkg().items[0], quantity: 4 },
              {
                ...pkg().items[0],
                id: 'pi-2',
                serviceId: 'svc-2',
                quantity: 2,
              },
            ],
          }),
        ],
      }),
    });

    const result = await port.listSellables({ kinds: ['package'] });
    if (result.status === 'blocked') throw new Error('expected a read');
    const price = result.sellables[0].price;
    expect(price.model).toBe('bundle');
    if (price.model !== 'bundle') return;
    expect(price.itemCount).toBe(6);
    expect(result.sellables[0].includedServiceIds).toEqual(['svc-1', 'svc-2']);
  });
});
