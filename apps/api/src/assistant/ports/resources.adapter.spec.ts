// Imported from the module directly, not the tool-factory barrel: the barrel
// reaches `confirmation.ts` → the database package, which this spec has no
// business booting.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';
import { createResourcesPort } from './resources.adapter.js';

/**
 * The property under test throughout: a 200 from the API is NOT evidence that
 * anything is bookable. A deactivated room, a schedule with no open day and a
 * requirement pointing at an empty category all save successfully, and each one
 * leaves a service unbookable. The port has no shape in which those are
 * success, and these tests are what hold that.
 */

const resourceRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  categoryId: 'c1',
  name: 'Room 2',
  isActive: true,
  capacity: 1,
  workingHours: null,
  locationId: null,
  ...overrides,
});

const categoryRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'c1',
  name: 'Rooms',
  kind: 'room',
  description: null,
  isActive: true,
  ...overrides,
});

interface StubRoutes {
  /** Keyed `"METHOD path-without-query"`. A function may throw. */
  [route: string]: unknown | (() => unknown);
}

function stub(routes: StubRoutes): ApiFetchFn {
  const fn = (async (pathArg: string, options?: { method?: string }) => {
    const key = `${options?.method ?? 'GET'} ${pathArg.split('?')[0]}`;
    if (!(key in routes)) throw new ApiFetchError(`no route: ${key}`, 500);
    const value = routes[key];
    return typeof value === 'function' ? (value as () => unknown)() : value;
  }) as unknown as ApiFetchFn;
  return fn;
}

const throws = (message: string, status: number) => () => {
  throw new ApiFetchError(message, status);
};

describe('resources adapter — write results', () => {
  it('reports a room with no schedule as allocatable, always-open', async () => {
    // `null` working hours mean the room inherits the clinic's hours. Reading
    // that as "never available" is the single most expensive mistake here.
    const port = createResourcesPort({
      apiFetch: stub({ 'POST resources': resourceRow() }),
    });

    const result = await port.createResource({
      categoryId: 'c1',
      name: 'Room 2',
    });

    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.resource.opensOn).toBeNull();
  });

  it('reports a room open on some days as allocatable, with those days', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'POST resources': resourceRow({
          workingHours: { '1': { from: 540, to: 1020 } },
        }),
      }),
    });

    const result = await port.createResource({
      categoryId: 'c1',
      name: 'Room 2',
    });

    expect(result.status).toBe('saved');
    if (result.status !== 'saved') return;
    expect(result.resource.opensOn).toEqual([1]);
  });

  it('refuses to call a room with an EMPTY schedule saved-and-ready', async () => {
    // 200 from the API. Zero open days. Nothing can ever be booked into it.
    const port = createResourcesPort({
      apiFetch: stub({ 'POST resources': resourceRow({ workingHours: {} }) }),
    });

    const result = await port.createResource({
      categoryId: 'c1',
      name: 'Room 2',
      workingHours: {},
    });

    expect(result).toEqual({
      status: 'saved_unallocatable',
      resource: expect.objectContaining({ resourceId: 'r1' }),
      reason: { kind: 'no_open_days' },
    });
  });

  it('reports a deactivated room as saved but unallocatable', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'PUT resources/r1': resourceRow({ isActive: false }),
      }),
    });

    const result = await port.updateResource({
      resourceId: 'r1',
      isActive: false,
    });

    expect(result.status).toBe('saved_unallocatable');
    if (result.status !== 'saved_unallocatable') return;
    expect(result.reason).toEqual({ kind: 'deactivated' });
  });

  it("carries the delete guard's own sentence rather than re-deriving it", async () => {
    const message =
      'Room 2 has 3 upcoming bookings. Deactivate it instead, or move those bookings first.';
    const port = createResourcesPort({
      apiFetch: stub({ 'DELETE resources/r1': throws(message, 409) }),
    });

    const result = await port.deleteResource('r1');

    expect(result).toEqual({
      status: 'not_deleted',
      reason: { kind: 'has_upcoming_bookings', message },
    });
  });

  it('separates a missing resource from a refused delete', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'DELETE resources/r1': throws('Resource not found', 404),
      }),
    });

    const result = await port.deleteResource('r1');

    expect(result).toEqual({
      status: 'not_deleted',
      reason: { kind: 'resource_not_found', resourceId: 'r1' },
    });
  });

  it('separates a stated refusal (4xx) from a server fault (5xx)', async () => {
    // Only the fault side is alertable. Collapsing the two is what made
    // ordinary "no, because…" answers page someone.
    const refused = createResourcesPort({
      apiFetch: stub({ 'POST resources/categories': throws('Nope', 422) }),
    });
    const faulted = createResourcesPort({
      apiFetch: stub({ 'POST resources/categories': throws('Boom', 500) }),
    });

    const a = await refused.createCategory({ name: 'Rooms' });
    const b = await faulted.createCategory({ name: 'Rooms' });

    expect(a).toMatchObject({ reason: { kind: 'other' } });
    expect(b).toMatchObject({ reason: { kind: 'server_error' } });
  });

  it('maps a category name clash onto duplicate_name', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'POST resources/categories': throws(
          'A resource category with this name already exists',
          409
        ),
      }),
    });

    const result = await port.createCategory({ name: 'Rooms' });

    expect(result).toEqual({
      status: 'not_saved',
      reason: { kind: 'duplicate_name', name: 'Rooms' },
    });
  });

  it('reports a non-empty category refusal with the server message', async () => {
    const message = 'Delete or move the 2 resources in this category first';
    const port = createResourcesPort({
      apiFetch: stub({
        'DELETE resources/categories/c1': throws(message, 409),
      }),
    });

    expect(await port.deleteCategory('c1')).toEqual({
      status: 'not_deleted',
      reason: { kind: 'category_not_empty', message },
    });
  });
});

describe('resources adapter — requirement satisfiability', () => {
  const written = (categoryId: string, eligibleResourceIds: string[] = []) => ({
    serviceId: 's1',
    turnaroundMinutes: 15,
    requirements: [{ categoryId, eligibleResourceIds }],
  });

  it('reports a rule as satisfiable only with the resources that satisfy it', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'PUT resources/requirements/s1': written('c1'),
        'GET resources/categories': [categoryRow()],
        'GET resources': [resourceRow()],
      }),
    });

    const result = await port.setServiceRequirements({
      serviceId: 's1',
      requirements: [{ categoryId: 'c1', eligibleResourceIds: [] }],
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.checks).toEqual([
      {
        kind: 'satisfiable',
        categoryId: 'c1',
        categoryName: 'Rooms',
        allocatableResourceIds: ['r1'],
      },
    ]);
  });

  it('catches the rule that makes a service unbookable — an empty category', async () => {
    // The write is a 200 and the rule set is exactly what was asked for. The
    // service is unbookable on every date from the moment it saves.
    const port = createResourcesPort({
      apiFetch: stub({
        'PUT resources/requirements/s1': written('c1'),
        'GET resources/categories': [categoryRow()],
        'GET resources': [],
      }),
    });

    const result = await port.setServiceRequirements({
      serviceId: 's1',
      requirements: [{ categoryId: 'c1', eligibleResourceIds: [] }],
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.checks).toEqual([
      {
        kind: 'unsatisfiable',
        categoryId: 'c1',
        categoryName: 'Rooms',
        reason: { kind: 'category_empty' },
      },
    ]);
  });

  it('does not count a room that cannot hold a booking towards satisfiability', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'PUT resources/requirements/s1': written('c1', ['r1']),
        'GET resources/categories': [categoryRow()],
        // Active, but its schedule names no open day.
        'GET resources': [resourceRow({ workingHours: {} })],
      }),
    });

    const result = await port.setServiceRequirements({
      serviceId: 's1',
      requirements: [{ categoryId: 'c1', eligibleResourceIds: ['r1'] }],
    });

    expect(result.status).toBe('applied');
    if (result.status !== 'applied') return;
    expect(result.checks[0]).toMatchObject({
      kind: 'unsatisfiable',
      reason: { kind: 'named_resources_unallocatable', resourceIds: ['r1'] },
    });
  });

  it('says applied_unverified when the check could not run at all', async () => {
    // The rules ARE saved. What may not be said is anything about bookability:
    // with no resource list read, "nothing is wrong" and "I did not look" are
    // the same silence. Same discipline as `partially_read` next door.
    const port = createResourcesPort({
      apiFetch: stub({
        'PUT resources/requirements/s1': written('c1'),
        'GET resources/categories': [categoryRow()],
        'GET resources': throws('Boom', 500),
      }),
    });

    const result = await port.setServiceRequirements({
      serviceId: 's1',
      requirements: [{ categoryId: 'c1', eligibleResourceIds: [] }],
    });

    expect(result.status).toBe('applied_unverified');
    if (result.status !== 'applied_unverified') return;
    expect(result.requirements).toEqual([
      { categoryId: 'c1', eligibleResourceIds: [] },
    ]);
    expect(result.message).toMatch(/could not be read back/i);
  });

  it('reports a failed write as not_applied — nothing was saved', async () => {
    const port = createResourcesPort({
      apiFetch: stub({
        'PUT resources/requirements/s1': throws('Service not found', 404),
      }),
    });

    expect(
      await port.setServiceRequirements({ serviceId: 's1', requirements: [] })
    ).toEqual({
      status: 'not_applied',
      reason: { kind: 'service_not_found', serviceId: 's1' },
    });
  });
});
