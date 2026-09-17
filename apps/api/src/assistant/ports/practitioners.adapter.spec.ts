// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import { createPractitionersPort } from './practitioners.adapter.js';

/** A practitioner row as the contract schema requires it — every field the
 *  atom declares, so a parse failure in the port is a real drift signal. */
function row(
  overrides: Partial<Record<string, unknown>> & { id: string; name: string }
) {
  return {
    id: overrides.id,
    organizationId: 'org-1',
    userId: null,
    name: overrides.name,
    firstName: null,
    lastName: null,
    email: 'staff@example.com',
    phone: null,
    phoneSecondary: null,
    phoneCountry: null,
    country: null,
    photo: null,
    bio: null,
    title: null,
    headline: null,
    dateOfBirth: null,
    employmentStartDate: null,
    employmentEndDate: null,
    employmentType: null,
    teamMemberRef: null,
    notes: null,
    acceptsBookings: true,
    languages: null,
    socialLinks: null,
    isActive: true,
    profileSetupCompleted: true,
    calendarAccountId: null,
    bookingAccountId: null,
    externalBookingId: null,
    bookingLink: null,
    workingHours: null,
    color: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...overrides,
  };
}

const junction = (serviceId: string, practitionerId = 'p1') => ({
  id: `ps-${serviceId}`,
  practitionerId,
  serviceId,
  createdAt: '2026-01-01T00:00:00.000Z',
});

/** `apiFetch` stub serving the two roster reads, or throwing for either. */
function stub(
  routes: { list?: unknown; forService?: unknown },
  throwFor: ('list' | 'forService')[] = [],
  status = 500
) {
  const fn = (async (pathArg: string) => {
    const key = pathArg.startsWith('practitioners/for-service')
      ? ('forService' as const)
      : ('list' as const);
    if (throwFor.includes(key)) throw new ApiFetchError(`boom: ${key}`, status);
    return (
      routes[key] ?? (key === 'list' ? { items: [], limit: 50, offset: 0 } : [])
    );
  }) as unknown as ApiFetchFn;
  return fn;
}

describe('practitioners port', () => {
  it('reads the roster and echoes the scope actually applied', async () => {
    const port = createPractitionersPort({
      apiFetch: stub({
        list: {
          items: [row({ id: 'p1', name: 'Aoife', title: 'Senior Stylist' })],
          limit: 50,
          offset: 0,
        },
      }),
    });

    const result = await port.listPractitioners({});

    expect(result.status).toBe('read');
    if (result.status !== 'read') return;
    expect(result.members).toEqual([
      {
        id: 'p1',
        name: 'Aoife',
        title: 'Senior Stylist',
        isActive: true,
        acceptsBookings: true,
        serviceIds: null,
        locationIds: null,
      },
    ]);
    expect(result.scope).toEqual({
      kind: 'whole_team',
      search: null,
      includesInactive: false,
    });
  });

  it('never egresses contact, birth, employment or notes fields', async () => {
    // The row carries email, phone, date of birth, employment dates and free
    // text notes. The roster fact Claire needs is the one on a booking page,
    // and a projection that widens by accident is how the rest leaks.
    const port = createPractitionersPort({
      apiFetch: stub({
        list: {
          items: [
            row({
              id: 'p1',
              name: 'Aoife',
              email: 'aoife.private@example.com',
              phone: '+353851234567',
              dateOfBirth: '1994-02-11',
              employmentStartDate: '2020-06-01',
              employmentType: 'full_time',
              notes: 'Requested a raise in March.',
            }),
          ],
          limit: 50,
          offset: 0,
        },
      }),
    });

    const result = await port.listPractitioners({});
    if (result.status === 'blocked') throw new Error('expected a read');

    const serialized = JSON.stringify(result.members);
    for (const secret of [
      'aoife.private@example.com',
      '+353851234567',
      '1994-02-11',
      '2020-06-01',
      'full_time',
      'raise in March',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(Object.keys(result.members[0]).sort()).toEqual([
      'acceptsBookings',
      'id',
      'isActive',
      'locationIds',
      'name',
      'serviceIds',
      'title',
    ]);
  });

  it('a full page is `partially_read` — a page is not a roster', async () => {
    // THE load-bearing property. The endpoint returns no total, so a full page
    // is indistinguishable from a truncated one. Reporting it as `read` is how
    // "you have 2 staff" gets said about a business with twenty.
    const port = createPractitionersPort({
      apiFetch: stub({
        list: {
          items: [
            row({ id: 'p1', name: 'Aoife' }),
            row({ id: 'p2', name: 'Niamh' }),
          ],
          limit: 2,
          offset: 0,
        },
      }),
    });

    const result = await port.listPractitioners({ limit: 2 });

    expect(result.status).toBe('partially_read');
    if (result.status !== 'partially_read') return;
    // There is no member in which an incomplete page carries a complete
    // verdict, and the continuation is required rather than optional.
    expect(result.more).toEqual({ returned: 2, limit: 2, nextOffset: 2 });
    expect(result).not.toHaveProperty('status', 'read');
  });

  it('a short page is complete', async () => {
    const port = createPractitionersPort({
      apiFetch: stub({
        list: {
          items: [row({ id: 'p1', name: 'Aoife' })],
          limit: 50,
          offset: 0,
        },
      }),
    });

    const result = await port.listPractitioners({ limit: 50 });
    expect(result.status).toBe('read');
  });

  it('an unloaded relation is null, NOT an empty list', async () => {
    // `for-service` loads locations but not services. Collapsing an absent
    // relation to `[]` would have Claire state that a stylist performs no
    // services — false, and actionable in the worst way.
    const port = createPractitionersPort({
      apiFetch: stub({ forService: [row({ id: 'p1', name: 'Aoife' })] }),
    });

    const forService = await port.findForService({ serviceId: 'svc-1' });
    if (forService.status === 'blocked') throw new Error('expected a read');
    expect(forService.members[0].serviceIds).toBeNull();

    // Loaded-and-genuinely-empty stays distinguishable from not-loaded.
    const loaded = createPractitionersPort({
      apiFetch: stub({
        list: {
          items: [row({ id: 'p1', name: 'Aoife', services: [] })],
          limit: 50,
          offset: 0,
        },
      }),
    });
    const roster = await loaded.listPractitioners({});
    if (roster.status === 'blocked') throw new Error('expected a read');
    expect(roster.members[0].serviceIds).toEqual([]);
  });

  it('carries service ids when the relation IS loaded', async () => {
    const port = createPractitionersPort({
      apiFetch: stub({
        list: {
          items: [
            row({
              id: 'p1',
              name: 'Aoife',
              services: [junction('svc-1'), junction('svc-2')],
            }),
          ],
          limit: 50,
          offset: 0,
        },
      }),
    });

    const result = await port.listPractitioners({});
    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.members[0].serviceIds).toEqual(['svc-1', 'svc-2']);
  });

  it('echoes the for-service active-only constraint it cannot opt out of', async () => {
    const port = createPractitionersPort({
      apiFetch: stub({ forService: [row({ id: 'p1', name: 'Aoife' })] }),
    });

    const result = await port.findForService({ serviceId: 'svc-1' });
    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.scope).toEqual({
      kind: 'for_service',
      serviceId: 'svc-1',
      search: null,
      activeOnly: true,
    });
  });

  it('applies the declared search rather than silently dropping it', async () => {
    // The route takes no search parameter, so the filter runs here. Declaring
    // it on the input and then ignoring it is the failure being avoided.
    const port = createPractitionersPort({
      apiFetch: stub({
        forService: [
          row({ id: 'p1', name: 'Aoife' }),
          row({ id: 'p2', name: 'Niamh' }),
        ],
      }),
    });

    const result = await port.findForService({
      serviceId: 'svc-1',
      search: 'niam',
    });
    if (result.status === 'blocked') throw new Error('expected a read');
    expect(result.members.map((m) => m.id)).toEqual(['p2']);
  });

  it('an unreadable roster is `blocked` — nothing was learned', async () => {
    const port = createPractitionersPort({ apiFetch: stub({}, ['list']) });

    const result = await port.listPractitioners({});

    expect(result.status).toBe('blocked');
    if (result.status !== 'blocked') return;
    expect(result.reason.kind).toBe('server_error');
  });

  it('a 4xx is a stated reason, not a server fault', async () => {
    const port = createPractitionersPort({ apiFetch: stub({}, ['list'], 403) });

    const result = await port.listPractitioners({});

    if (result.status !== 'blocked') throw new Error('expected blocked');
    // Only the fault side may page someone.
    expect(result.reason.kind).toBe('other');
  });

  it('maps a 404 on for-service to not_found, not a fault', async () => {
    const port = createPractitionersPort({
      apiFetch: stub({}, ['forService'], 404),
    });

    const result = await port.findForService({ serviceId: 'nope' });

    if (result.status !== 'blocked') throw new Error('expected blocked');
    expect(result.reason).toEqual({
      kind: 'not_found',
      what: 'service',
      id: 'nope',
    });
  });

  it('refuses a blank serviceId and an out-of-range page without calling anything', async () => {
    const apiFetch = jest.fn();
    const port = createPractitionersPort({
      apiFetch: apiFetch as unknown as ApiFetchFn,
    });

    const blank = await port.findForService({ serviceId: '  ' });
    expect(blank.status).toBe('blocked');
    if (blank.status === 'blocked') {
      expect(blank.reason.kind).toBe('invalid_input');
    }

    const oversized = await port.listPractitioners({ limit: 5000 });
    expect(oversized.status).toBe('blocked');
    if (oversized.status === 'blocked') {
      expect(oversized.reason.kind).toBe('invalid_input');
    }

    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('does not send isActive when inactive staff were asked for', async () => {
    const seen: string[] = [];
    const apiFetch = (async (pathArg: string) => {
      seen.push(pathArg);
      return { items: [], limit: 50, offset: 0 };
    }) as unknown as ApiFetchFn;
    const port = createPractitionersPort({ apiFetch });

    await port.listPractitioners({ includeInactive: true });
    expect(seen[0]).not.toContain('isActive');

    await port.listPractitioners({ includeInactive: false });
    expect(seen[1]).toContain('isActive=true');
  });
});
