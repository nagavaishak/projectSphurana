// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import { createSalesPort } from './sales.adapter.js';

const WINDOW = { from: '2026-03-02', to: '2026-03-03' } as const;

interface SummaryOverrides {
  saleCount?: number;
  totalCents?: number;
  tipCents?: number;
  currency?: string;
  byMethod?: Record<string, number>;
  methodRows?: Record<string, { collectedCents: number; refundsCents: number }>;
}

/** A `GET /sales/daily-summary` body that satisfies the contract schema. */
const summary = (date: string, o: SummaryOverrides = {}) => ({
  date,
  currency: o.currency ?? 'eur',
  saleCount: o.saleCount ?? 0,
  totalCents: o.totalCents ?? 0,
  tipCents: o.tipCents ?? 0,
  byMethod: o.byMethod ?? {},
  byItemType: {},
  itemRows: {},
  methodRows: o.methodRows ?? {},
});

/** A `GET /payments` row that satisfies the payment atom. */
const deposit = (o: {
  id: string;
  amountCents: number;
  paidAt: string | null;
  currency?: string;
}) => ({
  id: o.id,
  organizationId: 'org-1',
  leadId: null,
  amountCents: o.amountCents,
  currency: o.currency ?? 'eur',
  status: o.paidAt ? ('paid' as const) : ('pending' as const),
  description: null,
  stripeCheckoutSessionId: null,
  stripePaymentIntentId: null,
  stripeConnectedAccountId: 'acct_1',
  checkoutUrl: null,
  customerEmail: null,
  customerName: null,
  metadata: null,
  expiresAt: null,
  paidAt: o.paidAt,
  refundedAt: null,
  createdAt: '2026-03-01T09:00:00.000Z',
  updatedAt: '2026-03-01T09:00:00.000Z',
});

interface StubRoutes {
  /** Per-date summary bodies. A date absent from the map returns an empty day. */
  summaries?: Record<string, ReturnType<typeof summary>>;
  payments?: { items: unknown[]; total: number };
  /** Dates whose summary read should fault. */
  failDates?: string[];
  /** Fault the payments read. */
  failPayments?: boolean;
  status?: number;
}

function stub(routes: StubRoutes = {}) {
  const fn = (async (path: string) => {
    if (path.startsWith('sales/daily-summary')) {
      const date = new URLSearchParams(path.split('?')[1] ?? '').get('date');
      if (date && routes.failDates?.includes(date)) {
        throw new ApiFetchError(`boom: ${date}`, routes.status ?? 500);
      }
      return routes.summaries?.[date ?? ''] ?? summary(date ?? '2026-03-02');
    }
    if (path.startsWith('payments')) {
      if (routes.failPayments) {
        throw new ApiFetchError('boom: payments', routes.status ?? 500);
      }
      return routes.payments ?? { items: [], total: 0, limit: 100, offset: 0 };
    }
    throw new Error(`unexpected path: ${path}`);
  }) as unknown as ApiFetchFn;
  return fn;
}

const CASH_DAY = (date: string) =>
  summary(date, {
    saleCount: 2,
    totalCents: 5000,
    tipCents: 500,
    byMethod: { cash: 3000, card_terminal: 2500 },
    methodRows: {
      cash: { collectedCents: 3000, refundsCents: 0 },
      card_terminal: { collectedCents: 2500, refundsCents: 0 },
    },
  });

describe('sales takings port', () => {
  it('totals a fully-read window as `read` — the only status that may say so', async () => {
    const port = createSalesPort({
      apiFetch: stub({
        summaries: {
          '2026-03-02': CASH_DAY('2026-03-02'),
          '2026-03-03': CASH_DAY('2026-03-03'),
        },
      }),
    });

    const result = await port.getTakings(WINDOW);

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.pos.datesRead).toEqual(['2026-03-02', '2026-03-03']);
    expect(result.pos.saleCount).toBe(4);
    expect(result.pos.collected.amountCents).toBe(11_000);
    expect(result.pos.tips.amountCents).toBe(1000);
    expect(result.deposits.count).toBe(0);
  });

  it('labels every money value with its currency and never emits a bare number', async () => {
    // Cents on the wire. `5500` read as "€5,500" instead of "€55.00" is a
    // hundredfold error in a figure someone reconciles a till against, so the
    // unit and the currency travel with the value.
    const port = createSalesPort({
      apiFetch: stub({ summaries: { '2026-03-02': CASH_DAY('2026-03-02') } }),
    });

    const result = await port.getTakings({
      from: '2026-03-02',
      to: '2026-03-02',
    });

    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.pos.collected.amountCents).toBe(5500);
    expect(result.pos.collected.currency).toBe('eur');
    expect(result.pos.collected.formatted).toContain('55.00');
    for (const tender of result.pos.byTender) {
      expect(tender.collected.currency).toBe('eur');
      expect(tender.collected.formatted).toMatch(/\d/);
    }
  });

  it('an unreadable DAY makes the result `partially_read`, never `read`', async () => {
    // THE load-bearing property. One day of a two-day range faults; the other
    // reads clean. Presenting the surviving day's figure as the period's
    // takings is the exact failure this port exists to prevent — the owner
    // reconciles it against the till and someone gets accused of a short
    // drawer.
    const port = createSalesPort({
      apiFetch: stub({
        summaries: { '2026-03-02': CASH_DAY('2026-03-02') },
        failDates: ['2026-03-03'],
      }),
    });

    const result = await port.getTakings(WINDOW);

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.pos.datesRead).toEqual(['2026-03-02']);
    // The missing day is NAMED — "some of it is missing" is not a checkable
    // statement, "I could not read the 3rd" is.
    expect(result.unread[0]).toMatchObject({
      channel: 'pos',
      dates: ['2026-03-03'],
    });
    // There is no member in which an unread day coexists with a complete
    // verdict, so a consumer cannot phrase this as the period total.
    expect(result).not.toHaveProperty('status', 'read');
  });

  it('reports deposits as a channel of their own, not folded into till takings', async () => {
    // `payment` (deposit / checkout links) is a different table from
    // `sale_payment` and never appears in the daily summary. Omitting it is an
    // under-report; merging it into the till figure is a wrong till figure.
    const port = createSalesPort({
      apiFetch: stub({
        summaries: { '2026-03-02': CASH_DAY('2026-03-02') },
        payments: {
          items: [
            deposit({
              id: 'p1',
              amountCents: 2000,
              paidAt: '2026-03-02T11:00:00.000Z',
            }),
            // Paid outside the window — must not be counted.
            deposit({
              id: 'p2',
              amountCents: 9999,
              paidAt: '2026-02-01T11:00:00.000Z',
            }),
            // Never paid — must not be counted.
            deposit({ id: 'p3', amountCents: 4444, paidAt: null }),
          ],
          total: 3,
        },
      }),
    });

    const result = await port.getTakings({
      from: '2026-03-02',
      to: '2026-03-02',
    });

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.deposits).toEqual({
      count: 1,
      paid: expect.objectContaining({ amountCents: 2000, currency: 'eur' }),
    });
    // Till takings are untouched by the deposit.
    expect(result.pos.collected.amountCents).toBe(5500);
  });

  it('will not claim deposits are zero when it cannot prove it read them all', async () => {
    // `GET /payments` has no date filter and sorts by `createdAt` while what
    // matters is `paidAt`, so an unread page can hold a deposit paid inside the
    // window. A partial sum here would be a floor presented as a total.
    const port = createSalesPort({
      apiFetch: stub({
        summaries: { '2026-03-02': CASH_DAY('2026-03-02') },
        payments: { items: [], total: 5000 },
      }),
    });

    const result = await port.getTakings({
      from: '2026-03-02',
      to: '2026-03-02',
    });

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.deposits).toBeNull();
    expect(result.unread.some((g) => g.channel === 'deposits')).toBe(true);
  });

  it('a location-scoped total reports deposits missing rather than absent', async () => {
    // Deposit rows carry no location, so they cannot be scoped — which is a
    // gap in the answer, not an empty channel.
    const port = createSalesPort({
      apiFetch: stub({ summaries: { '2026-03-02': CASH_DAY('2026-03-02') } }),
    });

    const result = await port.getTakings({
      from: '2026-03-02',
      to: '2026-03-02',
      locationId: 'loc-1',
    });

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    expect(result.deposits).toBeNull();
    expect(result.unread[0].channel).toBe('deposits');
    expect(result.window.locationId).toBe('loc-1');
  });

  it('refuses to add two currencies into one total', async () => {
    const port = createSalesPort({
      apiFetch: stub({
        summaries: {
          '2026-03-02': CASH_DAY('2026-03-02'),
          '2026-03-03': summary('2026-03-03', {
            currency: 'gbp',
            totalCents: 100,
            byMethod: { cash: 100 },
          }),
        },
      }),
    });

    const result = await port.getTakings(WINDOW);

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('mixed_currency');
  });

  it('when nothing at all could be read it is `blocked` — no figure of any kind', async () => {
    const port = createSalesPort({
      apiFetch: stub({
        failDates: ['2026-03-02', '2026-03-03'],
        failPayments: true,
      }),
    });

    const result = await port.getTakings(WINDOW);

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('server_error');
  });

  it('a 4xx is a stated reason, not a server fault', async () => {
    const port = createSalesPort({
      apiFetch: stub({
        failDates: ['2026-03-02', '2026-03-03'],
        failPayments: true,
        status: 403,
      }),
    });

    const result = await port.getTakings(WINDOW);

    if (result.status !== 'blocked') throw new Error('expected blocked');
    // Only the fault side may page someone.
    expect(result.reason.kind).toBe('other');
  });

  it('refuses an inverted window without calling anything', async () => {
    const apiFetch = jest.fn();
    const port = createSalesPort({
      apiFetch: apiFetch as unknown as ApiFetchFn,
    });

    const result = await port.getTakings({
      from: '2026-03-04',
      to: '2026-03-02',
    });

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('invalid_window');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('refuses a window wider than it can fan out over, rather than truncating it', async () => {
    const apiFetch = jest.fn();
    const port = createSalesPort({
      apiFetch: apiFetch as unknown as ApiFetchFn,
    });

    const result = await port.getTakings({
      from: '2026-01-01',
      to: '2026-06-01',
    });

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('window_too_wide');
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('counts a refunded tender as collected AND refunded, matching the summary', async () => {
    const port = createSalesPort({
      apiFetch: stub({
        summaries: {
          '2026-03-02': summary('2026-03-02', {
            saleCount: 1,
            totalCents: 4000,
            byMethod: { card_terminal: 4000 },
            methodRows: {
              card_terminal: { collectedCents: 4000, refundsCents: 4000 },
            },
          }),
        },
      }),
    });

    const result = await port.getTakings({
      from: '2026-03-02',
      to: '2026-03-02',
    });

    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.pos.collected.amountCents).toBe(4000);
    expect(result.pos.refunded.amountCents).toBe(4000);
    expect(result.pos.byTender[0]).toMatchObject({
      method: 'card_terminal',
      label: 'Card Terminal',
    });
  });

  it('parses every read against a contract schema instead of asserting a type', async () => {
    // A drifted projection must fail loudly in `apiFetch` rather than yield
    // `undefined` fields that arithmetic quietly turns into a smaller total —
    // the same class of bug as `meta_ads_generateAdCopy` returning three nulls
    // with an OK status for months. The guarantee is that `schema` is supplied
    // on every call, so the real fetcher does the checking.
    const calls: { path: string; hasSchema: boolean }[] = [];
    const apiFetch = (async (path: string, options?: { schema?: unknown }) => {
      calls.push({ path, hasSchema: Boolean(options?.schema) });
      return path.startsWith('payments')
        ? { items: [], total: 0, limit: 100, offset: 0 }
        : summary('2026-03-02');
    }) as unknown as ApiFetchFn;

    const port = createSalesPort({ apiFetch });
    await port.getTakings({ from: '2026-03-02', to: '2026-03-02' });

    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((c) => c.hasSchema)).toBe(true);
  });
});
