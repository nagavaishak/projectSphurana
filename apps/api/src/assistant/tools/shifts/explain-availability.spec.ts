import type { ResourceReadResult } from '../../ports/resource-availability.reader.js';
import { isPathAllowed } from '../../tool-factory/path-whitelist.js';
import { explainAvailabilityTool } from './explain-availability.tool.js';

// The tool factory's confirmation surface reaches `db`; this tool is
// non-destructive so that path is never taken, but the import must resolve.
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

/**
 * The fifth source is the one read that does NOT go over `apiFetch` — it drives
 * the booking engine that gates the slots — so it is stubbed here rather than
 * served by the whitelist-enforcing fetch below. `resourceRead` is what each
 * test wants the rooms check to have learned.
 */
let resourceRead: ResourceReadResult = { status: 'not_applicable' };
jest.mock('../../ports/resource-availability.reader.js', () => ({
  createResourceAvailabilityReader: () => async () => resourceRead,
}));

/**
 * REGRESSION GUARD for a bug that shipped and that the adapter's own spec could
 * not see.
 *
 * `buildAssistantPorts` is handed the BASE `apiFetch` (`tool-context.ts`), and
 * none of shifts / blocked-time / time-off / opening-hours is on the base path
 * whitelist. So a tool reading `ctx.ports.availability` would fail the path
 * check on EVERY call in production — while `availability.adapter.spec.ts`,
 * which stubs `apiFetch` wholesale, stayed green. A stub cannot fail a
 * whitelist it never runs.
 *
 * These tests exercise the real `isPathAllowed` against the tool's own declared
 * `additionalAllowedPaths`, so they fail if either half regresses:
 *   - the tool goes back to the shared port (base whitelist), or
 *   - the adapter learns a new endpoint the tool has not whitelisted.
 */

const WORKING_DAY = {
  practitionerId: 'p1',
  date: '2026-03-02',
  dayOfWeek: 1,
  isOff: false,
  source: 'weekly' as const,
  intervals: [
    { shiftId: 's1', startMinutes: 540, endMinutes: 1020, locationId: null },
  ],
};

/** Records every path requested and REJECTS any the whitelist would reject. */
function whitelistEnforcingFetch(allowed: readonly RegExp[] | undefined) {
  const paths: string[] = [];
  const fn = (async (path: string) => {
    paths.push(path);
    if (!isPathAllowed(path, allowed)) {
      throw new Error(`PATH NOT ALLOWED: ${path}`);
    }
    if (path.startsWith('shifts')) return [WORKING_DAY];
    if (path.includes('opening-hours')) {
      return {
        locationId: 'loc-1',
        openingHours: null,
        organizationDefault: null,
        exceptions: [],
      };
    }
    return [];
  }) as never;
  return { fn, paths };
}

function buildCtx(apiFetch: never, extended: never) {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    // The factory reads `callerRole`, not `role` — an absent one is a
    // deliberate REFUSAL, not a pass, so the stub must supply it.
    callerRole: 'member',
    apiFetch,
    buildApiFetch: jest.fn(() => extended),
    // If the tool reads the SHARED port, this throws — which is exactly the
    // bug being guarded. The shared port is composed over the base fetch.
    ports: {
      availability: {
        explainAvailability: () => {
          throw new Error(
            'used ctx.ports.availability — that port is composed over the BASE apiFetch, whose whitelist excludes every availability route'
          );
        },
      },
    },
    reportIssue: jest.fn(),
    confirmedActions: [],
    callCounter: { count: 0, max: 25 },
  } as never;
}

describe('shifts_explainAvailability — path whitelist', () => {
  it('every path it requests is covered by its own additionalAllowedPaths', async () => {
    const base = whitelistEnforcingFetch(undefined);
    const extended = whitelistEnforcingFetch(
      explainAvailabilityTool.additionalAllowedPaths
    );

    const result = await explainAvailabilityTool.execute(
      { from: '2026-03-02', to: '2026-03-03', locationId: 'loc-1' } as never,
      buildCtx(base.fn, extended.fn)
    );

    // Surface the reason rather than a bare false — a whitelist rejection and
    // a missing ctx field look identical otherwise.
    expect(result.ok ? null : result.error).toBeNull();
    expect(result.ok).toBe(true);
    // All five sources were actually reached — a silent whitelist rejection
    // would surface as `unchecked`, not as a thrown error, so assert the
    // positive.
    if (!result.ok || !result.data) return;
    expect(result.data.unchecked).toBeUndefined();

    expect(extended.paths.some((p) => p.startsWith('shifts'))).toBe(true);
    expect(extended.paths.some((p) => p.startsWith('blocked-time'))).toBe(true);
    expect(extended.paths.some((p) => p.startsWith('time-off'))).toBe(true);
    expect(extended.paths.some((p) => p.includes('opening-hours'))).toBe(true);
  });

  it('none of its paths is on the BASE whitelist — so the shared port cannot serve it', () => {
    // Pins the reason the tool composes its own port. If someone later adds
    // these to the base whitelist (or threads a path-extended fetch into
    // buildAssistantPorts), this test fails and the workaround can be removed
    // deliberately rather than left as cargo.
    for (const path of [
      'shifts?from=2026-03-02&to=2026-03-03',
      'blocked-time?from=2026-03-02&to=2026-03-03',
      'time-off?from=2026-03-02&to=2026-03-03',
      'locations/loc-1/opening-hours?from=2026-03-02&to=2026-03-03',
    ]) {
      expect(isPathAllowed(path, undefined)).toBe(false);
      expect(
        isPathAllowed(path, explainAvailabilityTool.additionalAllowedPaths)
      ).toBe(true);
    }
  });
});

/**
 * The copy, which is the whole deliverable of the fifth source.
 *
 * A structured blocker an owner cannot read is not a diagnosis. These pin the
 * sentence that turns "no slots" into something actionable — and, in
 * particular, the SECOND sentence, which explains why a free practitioner
 * still cannot take the booking. That is the non-obvious part of resource
 * gating and the reason an owner would otherwise go looking at the rota.
 */
describe('shifts_explainAvailability — rooms and equipment', () => {
  const run = async () => {
    const base = whitelistEnforcingFetch(undefined);
    const extended = whitelistEnforcingFetch(
      explainAvailabilityTool.additionalAllowedPaths
    );
    return explainAvailabilityTool.execute(
      {
        from: '2026-03-02',
        to: '2026-03-03',
        locationId: 'loc-1',
        serviceId: 'svc-1',
      } as never,
      buildCtx(base.fn, extended.fn)
    );
  };

  afterEach(() => {
    resourceRead = { status: 'not_applicable' };
  });

  it('names the rooms, the window, and why a free practitioner cannot help', async () => {
    resourceRead = {
      status: 'checked',
      categories: [{ categoryId: 'cat-room', name: 'Treatment rooms' }],
      blockers: [
        {
          kind: 'no_free_resource',
          dates: ['2026-03-03'],
          categoryId: 'cat-room',
          categoryName: 'Treatment rooms',
          categoryNoun: 'room',
          windows: [{ from: '14:00', to: '15:00' }],
          allDay: false,
          contention: [
            { resourceId: 'r2', name: 'Room 2', busy: [], closed: false },
            { resourceId: 'r3', name: 'Room 3', busy: [], closed: false },
          ],
        },
      ],
    };

    const result = await run();
    if (!result.ok || !result.data) throw new Error('expected data');
    const blocker = result.data.blockers?.find(
      (b) => b.kind === 'no_free_resource'
    );
    expect(blocker?.detail).toBe(
      'Room 2 and Room 3 are both booked 14:00–15:00. This service needs a ' +
        'room, so no practitioner can take it.'
    );
    expect(result.data.unchecked).toBeUndefined();
  });

  it('an org with no rooms configured says so, rather than staying silent', async () => {
    // "We never set rooms up" is the common case, and silence about it reads
    // as a shrug — Claire should be able to rule the room out loud.
    const result = await run();
    if (!result.ok || !result.data) throw new Error('expected data');
    expect(result.data.resources).toEqual({ applies: false });
    expect(result.data.summary).toContain('Nothing is blocking bookings');
  });

  it('an unreadable rooms check refuses to phrase the answer as clear', async () => {
    resourceRead = { status: 'unread', fault: 'db down' };
    const result = await run();
    if (!result.ok || !result.data) throw new Error('expected data');
    expect(result.data.unchecked).toEqual(['rooms and equipment']);
    expect(result.data.summary).toContain("I can't tell you it's clear");
    // No shape the model could read as "rooms are fine".
    expect(result.data.resources).toBeUndefined();
  });
});
