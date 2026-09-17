import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { factoryRootMap, scanQueryKeys } from './query-keys.scan';

/**
 * The query-key gate.
 *
 * TanStack matches keys by PREFIX, so `invalidateQueries({ queryKey: ['session'] })`
 * when the real key is `['auth', 'session']` is a **silent no-op**: no throw, no
 * log, no failing test — the mutation reports success and the cache goes on
 * serving stale data. Nine of these shipped; the worst meant switching
 * organisation did not refresh the session, so the app kept serving the
 * PREVIOUS tenant's `activeOrganizationId` as fresh.
 *
 * Two checks, both DERIVED from the source (a gate whose input is a hand-typed
 * list cannot fail to mention the thing that is missing — that is how every
 * gate in this repo has failed so far):
 *
 *   1. **No dead roots.** Enumerate every root that is INVALIDATED and every
 *      root that is DEFINED by a real query, and fail on any root invalidated
 *      that no query answers to. ~30 lines; it finds all nine (and a tenth the
 *      audit missed).
 *   2. **Raw-literal ratchet.** 490 `queryKey:` sites predate the factory, so
 *      this is a ratchet rather than a ban: the per-file count of raw array
 *      literals may only go DOWN. A NEW raw literal — in a new file, or one
 *      more in an existing one — fails immediately.
 *
 * Regenerate the ratchet after removing raw literals:
 *   UPDATE_QUERY_KEY_BASELINE=1 pnpm --filter @borradh-workspace/app test query-keys
 * It only ever writes counts that went down; it cannot be used to bless a new one.
 *
 * @see docs/engineering/derived-gates-and-operation-spine.md (W4)
 */

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_FILE = path.join(SRC, 'lib', 'query-keys.baseline.json');

const scan = scanQueryKeys(SRC);

const at = (site: { file: string; line: number; text: string }) =>
  `${site.file}:${site.line}  ${site.text}`;

describe('query keys are derived, not spelled', () => {
  it('scans the real tree', () => {
    // Guards the scanner itself: if a refactor breaks resolution, the two
    // checks below would go green by seeing nothing.
    expect(scan.definitions.length).toBeGreaterThan(100);
    expect(scan.usages.length).toBeGreaterThan(200);
    expect(factoryRootMap.size).toBeGreaterThan(0);
  });

  /**
   * THE CHECK THAT WOULD HAVE CAUGHT THIS ON DAY ONE.
   *
   * A root that is invalidated but never defined can only be a typo or a
   * rename — there is no legitimate reason to invalidate a key that no query
   * has. If you are tempted to add an exemption here, you are about to ship a
   * no-op.
   */
  it('never invalidates a root that no query defines', () => {
    const defined = new Set(
      scan.definitions.flatMap((site) => site.roots ?? [])
    );

    const dead = scan.usages.filter(
      (site) =>
        site.roots !== null &&
        site.roots.length > 0 &&
        site.roots.every((root) => !defined.has(root))
    );

    const report = dead
      .map(
        (site) => `  [${site.roots?.join('|')}] via ${site.op} — ${at(site)}`
      )
      .join('\n');

    expect(
      dead.length,
      dead.length === 0
        ? ''
        : `\n${dead.length} DEAD query-key invalidation(s) — TanStack matches by prefix, ` +
            `so each of these is a silent no-op and the cache stays stale:\n${report}\n\n` +
            `Defined roots:\n  ${[...defined].sort().join(', ')}\n`
    ).toBe(0);
  });

  /**
   * The factory must not invent roots either — a `queryKeys.foo.bar()` that no
   * query answers to is the same bug wearing a nicer hat.
   */
  it('produces only roots that real queries define', () => {
    const defined = new Set(
      scan.definitions.flatMap((site) => site.roots ?? [])
    );

    const invented = [...factoryRootMap.entries()]
      .filter(([, root]) => !defined.has(root))
      .map(
        ([factoryPath, root]) => `  queryKeys.${factoryPath}() → ['${root}', …]`
      );

    expect(
      invented.length,
      invented.length === 0
        ? ''
        : `\nThe factory produces roots no query defines:\n${invented.join('\n')}\n`
    ).toBe(0);
  });

  /**
   * The ratchet. New raw literals fail; the existing ones may only be removed.
   */
  it('never adds a raw array-literal query key (ratchet)', () => {
    const counts = new Map<string, number>();
    for (const site of [...scan.definitions, ...scan.usages]) {
      if (!site.isRawLiteral) continue;
      counts.set(site.file, (counts.get(site.file) ?? 0) + 1);
    }

    const baseline: Record<string, number> = JSON.parse(
      fs.readFileSync(BASELINE_FILE, 'utf8')
    );

    const regressions: string[] = [];
    for (const [file, count] of [...counts].sort()) {
      const allowed = baseline[file] ?? 0;
      if (count > allowed) {
        const hint =
          allowed === 0 ? '  ← new file / new key: use queryKeys.*' : '';
        regressions.push(
          `  ${file}: ${count} raw literal(s), baseline ${allowed}${hint}`
        );
      }
    }

    if (
      process.env.UPDATE_QUERY_KEY_BASELINE === '1' &&
      regressions.length === 0
    ) {
      const next = Object.fromEntries([...counts].sort());
      fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
    }

    expect(
      regressions.join('\n'),
      regressions.length === 0
        ? ''
        : `\nRaw array-literal query keys may only go DOWN. Spell the key in \`src/lib/query-keys.ts\` and use the factory:\n${regressions.join('\n')}\n`
    ).toBe('');

    // And the total may not creep up via files the baseline never knew about.
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    const baselineTotal = Object.values(baseline).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(baselineTotal);
  });
});
