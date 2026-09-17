import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import type { InspirationVerdict } from './select-inspiration-set.schema.js';
import { selectInspirationSet } from './select-inspiration-set.service.js';

// No `vi.mock` here on purpose: `@borradh-workspace/storage` is already aliased
// to the shared mock in vite.config.ts, and this package runs with
// `isolate: false` — a file-local factory registers globally and has previously
// broken unrelated suites depending on file order.

const ORG = 'org-1';
const DAY = 1000 * 60 * 60 * 24;

interface Row {
  objectKey: string | null;
  postedAt: Date | null;
  verdict: InspirationVerdict | null;
}

/** A db whose only job is to hand back the rows a test declares. */
function dbWith(rows: Row[]) {
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: async () => rows,
  };
  return chain as never;
}

function verdict(over: Partial<InspirationVerdict> = {}): InspirationVerdict {
  const colourway = over.colourway ?? 'light-ground';
  const layout = over.layout ?? 'type-led-panel';
  return {
    kind: 'branded-graphic',
    isDesign: true,
    usable: true,
    colourway,
    layout,
    designFamily: `${colourway}|${layout}`,
    ...over,
  };
}

/** `daysAgo` days before now, so age-based rules are exercised for real. */
const ago = (days: number) => new Date(Date.now() - days * DAY);

function row(
  key: string,
  daysAgo: number,
  over: Partial<InspirationVerdict> = {}
): Row {
  return { objectKey: key, postedAt: ago(daysAgo), verdict: verdict(over) };
}

describe('selectInspirationSet', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty set rather than failing when nothing is usable', async () => {
    const result = await selectInspirationSet(
      dbWith([row('a.jpg', 10, { isDesign: false })]),
      { organizationId: ORG }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectKeys).toEqual([]);
      expect(result.data.candidateCount).toBe(0);
      // Callers branch on this to decide whether to render without references.
      expect(result.data.consistencyScore).toBe(0);
    }
  });

  it('excludes photos and unusable posts from the candidate pool', async () => {
    const result = await selectInspirationSet(
      dbWith([
        row('design-1.jpg', 10),
        row('design-2.jpg', 40),
        row('photo.jpg', 12, { isDesign: false, kind: 'photo' }),
        row('clinical.jpg', 14, { usable: false, kind: 'before-after' }),
      ]),
      { organizationId: ORG }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.candidateCount).toBe(2);
      expect(result.data.objectKeys).not.toContain('photo.jpg');
      expect(result.data.objectKeys).not.toContain('clinical.jpg');
    }
  });

  // THE CALIBRATED CASE. A burst of campaign posts inside a few days must not
  // become the brand's permanent look just because there are more of them.
  it('prefers the everyday look over a larger campaign burst', async () => {
    const campaign = [
      row('bf-1.jpg', 30, { colourway: 'dark-ground' }),
      row('bf-2.jpg', 30, { colourway: 'dark-ground' }),
      row('bf-3.jpg', 30, { colourway: 'dark-ground' }),
      row('bf-4.jpg', 31, { colourway: 'dark-ground' }),
    ];
    const houseStyle = [
      row('house-1.jpg', 5, { colourway: 'light-ground' }),
      row('house-2.jpg', 60, { colourway: 'light-ground' }),
      row('house-3.jpg', 120, { colourway: 'light-ground' }),
    ];

    const result = await selectInspirationSet(
      dbWith([...campaign, ...houseStyle]),
      {
        organizationId: ORG,
      }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.colourway).toBe('light-ground');
      expect(result.data.objectKeys).toEqual([
        'house-1.jpg',
        'house-2.jpg',
        'house-3.jpg',
      ]);
    }
  });

  // The regression that a 2-month threshold caused: a real colourway posted
  // across ~1.9 months was discarded as a burst.
  it('keeps a genuine colourway spread over about two months', async () => {
    const result = await selectInspirationSet(
      dbWith([
        row('dark-1.jpg', 5, { colourway: 'dark-ground' }),
        row('dark-2.jpg', 30, { colourway: 'dark-ground' }),
        row('dark-3.jpg', 57, { colourway: 'dark-ground' }),
        row('light-1.jpg', 10, { colourway: 'light-ground' }),
      ]),
      { organizationId: ORG }
    );
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.colourway).toBe('dark-ground');
  });

  it('prefers the modal layout within the chosen colourway', async () => {
    const result = await selectInspirationSet(
      dbWith([
        // Newest, but the odd one out structurally.
        row('odd.jpg', 1, { layout: 'split-or-two-up' }),
        row('modal-1.jpg', 20, { layout: 'type-led-panel' }),
        row('modal-2.jpg', 50, { layout: 'type-led-panel' }),
        row('modal-3.jpg', 80, { layout: 'type-led-panel' }),
      ]),
      { organizationId: ORG, setSize: 3 }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // Recency alone would have taken `odd.jpg` first; coherence wins.
      expect(result.data.objectKeys).toEqual([
        'modal-1.jpg',
        'modal-2.jpg',
        'modal-3.jpg',
      ]);
    }
  });

  it('scores an inconsistent brand low and a consistent one high', async () => {
    const consistent = await selectInspirationSet(
      dbWith([
        row('a.jpg', 5),
        row('b.jpg', 40),
        row('c.jpg', 90),
        row('d.jpg', 120),
      ]),
      { organizationId: ORG }
    );
    const scattered = await selectInspirationSet(
      dbWith([
        row('a.jpg', 5, { colourway: 'light-ground' }),
        row('b.jpg', 40, { colourway: 'dark-ground' }),
        row('c.jpg', 90, { colourway: 'brand-colour-ground' }),
        row('d.jpg', 120, { colourway: 'photo-led' }),
      ]),
      { organizationId: ORG }
    );
    expect(consistent.success && scattered.success).toBe(true);
    if (consistent.success && scattered.success) {
      expect(consistent.data.consistencyScore).toBe(1);
      expect(scattered.data.consistencyScore).toBe(0.25);
    }
  });

  it('drops posts older than the age cutoff', async () => {
    const result = await selectInspirationSet(
      dbWith([row('recent.jpg', 30), row('ancient.jpg', 800)]),
      { organizationId: ORG }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectKeys).toEqual(['recent.jpg']);
    }
  });

  it('honours a forced colourway', async () => {
    const result = await selectInspirationSet(
      dbWith([
        row('light-1.jpg', 5, { colourway: 'light-ground' }),
        row('light-2.jpg', 40, { colourway: 'light-ground' }),
        row('light-3.jpg', 70, { colourway: 'light-ground' }),
        row('dark-1.jpg', 10, { colourway: 'dark-ground' }),
        row('dark-2.jpg', 50, { colourway: 'dark-ground' }),
      ]),
      { organizationId: ORG, colourway: 'dark-ground' }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.colourway).toBe('dark-ground');
      expect(result.data.objectKeys).toEqual(['dark-1.jpg', 'dark-2.jpg']);
    }
  });

  it('resolves one URL for every chosen key', async () => {
    const result = await selectInspirationSet(
      dbWith([row('a.jpg', 5), row('b.jpg', 40)]),
      { organizationId: ORG }
    );
    expect(result.success).toBe(true);
    if (result.success) {
      // The contract is parity: a stored key is not fetchable on its own, and
      // callers zip these two lists. The URL's exact shape is storage's job and
      // is asserted there — this package runs with `isolate: false`, so the
      // shared storage mock's return value is not stable across suite order.
      expect(result.data.urls).toHaveLength(result.data.objectKeys.length);
      expect(result.data.objectKeys).toEqual(['a.jpg', 'b.jpg']);
    }
  });

  it('rejects an empty organizationId', async () => {
    const result = await selectInspirationSet(dbWith([]), {
      organizationId: '',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('suitability ranking', () => {
  const design = (over: Record<string, unknown>) => ({
    suitability: 3,
    layout: 'type-led-panel',
    ageMonths: 1,
    ...over,
  });

  /**
   * These mirror the comparator in `selectInspirationSet`: suitability first,
   * then the family's modal layout, then recency. Kept as a unit because the
   * ordering is the whole point of the change — coherence used to decide
   * everything, so selection could answer "which posts look alike?" but never
   * "which are any good?", and a brand whose feed is mostly announcements has a
   * very coherent family of announcements.
   */
  const rank = (items: ReturnType<typeof design>[], modalLayout: string) =>
    [...items].sort((a, b) => {
      if (a.suitability !== b.suitability) return b.suitability - a.suitability;
      const aModal = a.layout === modalLayout ? 0 : 1;
      const bModal = b.layout === modalLayout ? 0 : 1;
      return aModal - bModal || a.ageMonths - b.ageMonths;
    });

  it('puts the best design first even when it is off the modal layout', () => {
    const out = rank(
      [
        design({ suitability: 3, layout: 'type-led-panel' }),
        design({ suitability: 5, layout: 'photo-with-text-overlay' }),
      ],
      'type-led-panel'
    );
    expect(out[0].suitability).toBe(5);
  });

  it('falls back to modal layout, then recency, when scores tie', () => {
    const out = rank(
      [
        design({ layout: 'split-or-two-up', ageMonths: 1 }),
        design({ layout: 'type-led-panel', ageMonths: 9 }),
        design({ layout: 'type-led-panel', ageMonths: 2 }),
      ],
      'type-led-panel'
    );
    expect(out.map((d) => d.ageMonths)).toEqual([2, 9, 1]);
  });
});

describe('logoMatch admission', () => {
  type Row = { logoMatch: string; designFamily: string };

  /** Mirrors the admission filter in `selectInspirationSet`. */
  const admit = (rows: Row[]) => {
    const hasOwnMark = rows.some((r) => r.logoMatch === 'match');
    const matchedFamilies = new Set(
      rows.filter((r) => r.logoMatch === 'match').map((r) => r.designFamily)
    );
    return rows.filter((r) => {
      if (!hasOwnMark) return r.logoMatch !== 'different';
      if (r.logoMatch === 'match') return true;
      return r.logoMatch === 'absent' && matchedFamilies.has(r.designFamily);
    });
  };

  it('tops up from mark-less posts in a family that DOES carry the mark', () => {
    // A salon stamped its logo on 3 posts of 28. Requiring `match` outright
    // discarded 25 and selected from the rest — one of which was a blurry
    // shopfront captioned "April offers".
    const rows: Row[] = [
      { logoMatch: 'match', designFamily: 'light-gold|type-led-panel' },
      { logoMatch: 'absent', designFamily: 'light-gold|type-led-panel' },
      { logoMatch: 'absent', designFamily: 'light-gold|type-led-panel' },
    ];
    expect(admit(rows)).toHaveLength(3);
  });

  it('still refuses a mark-less post from an unrelated family', () => {
    // The reason the rule exists: admitting `absent` once let ten of another
    // business's posts into an org's pool. A foreign post rarely shares this
    // brand's palette AND layout.
    const rows: Row[] = [
      { logoMatch: 'match', designFamily: 'light-gold|type-led-panel' },
      {
        logoMatch: 'absent',
        designFamily: 'dark-blue|photo-with-text-overlay',
      },
    ];
    expect(admit(rows)).toHaveLength(1);
  });

  it('never admits a post carrying a DIFFERENT mark', () => {
    const rows: Row[] = [
      { logoMatch: 'match', designFamily: 'f' },
      { logoMatch: 'different', designFamily: 'f' },
    ];
    expect(admit(rows).every((r) => r.logoMatch !== 'different')).toBe(true);
  });

  it('falls back to everything non-conflicting when the org has no mark anywhere', () => {
    const rows: Row[] = [
      { logoMatch: 'absent', designFamily: 'a' },
      { logoMatch: 'absent', designFamily: 'b' },
      { logoMatch: 'different', designFamily: 'c' },
    ];
    expect(admit(rows)).toHaveLength(2);
  });
});
