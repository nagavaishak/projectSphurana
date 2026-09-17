import { describe, expect, it } from 'vitest';

import type { WebsiteAnalysisPlan } from '../../api/types';
import {
  VALUE_KEYS,
  buildApplyInput,
  defaultSelection,
  hasStableKeys,
  isNoOpPlan,
} from './plan-selection';

/** A plan with nothing in it, for tests to fill in only what they care about. */
const emptyPlan = (
  overrides: Partial<WebsiteAnalysisPlan> = {}
): WebsiteAnalysisPlan =>
  ({
    scanned: ['services', 'packages', 'team', 'location'],
    services: { create: [], priceChanges: [], notFound: [], unchanged: 0 },
    packages: { create: [], notFound: [], blocked: [] },
    team: { create: [], notFound: [] },
    locations: { create: [], blocked: [], matched: 0 },
    description: { locationId: null, current: null, scanned: null },
    hours: { current: null, scanned: null },
    brand: { current: {}, scanned: {} },
    ...overrides,
  }) as WebsiteAnalysisPlan;

const service = (key: string, name: string) =>
  ({ key, name, priceType: 'fixed', priceCents: 1000 }) as never;

describe('defaultSelection', () => {
  it('ticks what a scan adds and leaves switch-offs alone', () => {
    const plan = emptyPlan({
      services: {
        create: [service('service.create:a', 'A')],
        priceChanges: [],
        notFound: [{ key: 'service.deactivate:x', id: 'x', name: 'X' }],
        unchanged: 0,
      },
    });

    const selected = defaultSelection(plan);

    expect(selected.has('service.create:a')).toBe(true);
    // Switching a service off is the one lossy thing an apply can do, so it is
    // never the default.
    expect(selected.has('service.deactivate:x')).toBe(false);
  });

  it('ticks a value section only when the scan produced one', () => {
    const plan = emptyPlan({
      scanned: ['description', 'hours'],
      description: { locationId: 'l1', current: null, scanned: 'About us' },
    });

    const selected = defaultSelection(plan);

    expect(selected.has(VALUE_KEYS.description)).toBe(true);
    expect(selected.has(VALUE_KEYS.hours)).toBe(false);
  });
});

describe('buildApplyInput', () => {
  const plan = emptyPlan({
    services: {
      create: [
        service('service.create:a', 'A'),
        service('service.create:b', 'B'),
      ],
      priceChanges: [],
      notFound: [{ key: 'service.deactivate:x', id: 'x', name: 'X' }],
      unchanged: 0,
    },
  });

  it('is additive by default and never proposes a switch-off', () => {
    const { modes, deselected } = buildApplyInput(plan, defaultSelection(plan));

    expect(modes.services).toBe('add');
    // The untouched switch-off row is deselected, so `add` and `replace` would
    // do the same thing here — the mode alone can't cause a surprise.
    expect(deselected).toEqual(['service.deactivate:x']);
  });

  it('drops exactly the row the owner un-ticked', () => {
    const selected = new Set(['service.create:a']);

    const { modes, deselected } = buildApplyInput(plan, selected);

    expect(modes.services).toBe('add');
    expect(deselected).toContain('service.create:b');
    expect(deselected).not.toContain('service.create:a');
  });

  it('derives replace from a ticked switch-off row, not from a mode control', () => {
    const selected = new Set([
      'service.create:a',
      'service.create:b',
      'service.deactivate:x',
    ]);

    const { modes, deselected } = buildApplyInput(plan, selected);

    expect(modes.services).toBe('replace');
    expect(deselected).toEqual([]);
  });

  it('ignores a section with nothing ticked at all', () => {
    const { modes } = buildApplyInput(plan, new Set());

    expect(modes.services).toBe('ignore');
  });

  it('maps value sections to apply / ignore', () => {
    const valuePlan = emptyPlan({
      scanned: ['description', 'hours', 'brand'],
      description: { locationId: 'l1', current: null, scanned: 'About' },
      hours: { current: null, scanned: { '1': { from: 540, to: 1020 } } },
    });

    const { modes } = buildApplyInput(
      valuePlan,
      new Set([VALUE_KEYS.description])
    );

    expect(modes.description).toBe('apply');
    expect(modes.hours).toBe('ignore');
    expect(modes.brand).toBe('ignore');
  });
});

describe('hasStableKeys', () => {
  it('accepts a plan whose rows the server keyed', () => {
    expect(
      hasStableKeys(
        emptyPlan({
          services: {
            create: [service('service.create:a', 'A')],
            priceChanges: [],
            notFound: [],
            unchanged: 0,
          },
        })
      )
    ).toBe(true);
  });

  it('rejects a plan from an API too old to key its rows', () => {
    // What a frontend sees mid-rolling-deploy: every row keyless, so every
    // checkbox would share one identity and toggle the whole plan at once.
    const plan = emptyPlan({
      services: {
        create: [{ name: 'A', priceType: 'fixed', priceCents: 1000 } as never],
        priceChanges: [],
        notFound: [],
        unchanged: 0,
      },
    });

    expect(hasStableKeys(plan)).toBe(false);
  });
});

describe('isNoOpPlan', () => {
  it('is true when the account already matches the website', () => {
    expect(
      isNoOpPlan(
        emptyPlan({
          services: {
            create: [],
            priceChanges: [],
            notFound: [],
            unchanged: 12,
          },
        })
      )
    ).toBe(true);
  });

  it('is false as soon as there is one row to act on', () => {
    expect(
      isNoOpPlan(
        emptyPlan({
          services: {
            create: [service('service.create:a', 'A')],
            priceChanges: [],
            notFound: [],
            unchanged: 0,
          },
        })
      )
    ).toBe(false);
  });
});
