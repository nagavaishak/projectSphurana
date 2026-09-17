import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './endpoint-coverage.js';
import {
  type AssertedResponse,
  collectAssertedResponses,
} from './response-derivation.js';
import { ASSERTED_BASELINE } from './response-derivation.manifest.js';

/**
 * ARCHITECTURE TEST — GATE 4: tool responses are derived, not asserted.
 *
 * Gate 1 proves a capability EXISTS. Gate 2 proves it has an implementation.
 * Neither looks at a field name, and field names are where two shipped defects
 * actually lived:
 *
 *   - `meta_ads_generateAdCopy` read `data.headline`; the API returns
 *     `content.headline`. Broken on 100% of calls, for months, green suite.
 *   - `context_listServices` read `pricingDescription`, which is not a column
 *     on `organization_service`. Null pricing for every service, always.
 *
 * Both were structurally valid — the files agreed with each other and were
 * collectively wrong — and both had unit tests mocking the SAME wrong shape.
 * When one author writes the reader and the mock, the errors are correlated by
 * construction, so a mocked test is the weakest gate available, not the
 * strongest.
 *
 * What breaks the correlation statically is DERIVING the response type from a
 * contracts schema, so `tsc` owns the field names instead of the author:
 *
 *   ctx.apiFetch<ServiceListApiResponse>('organization-services')   // asserted
 *   ctx.apiFetch('organization-services', { schema: listServicesResponseSchema })
 *
 * Verified, not argued: with the schema attached and the old field still read,
 * `tsc` emits `TS2339: Property 'pricingDescription' does not exist`.
 *
 * THE RATCHET
 * -----------
 * `ASSERTED_BASELINE` maps a file to how many asserted `apiFetch<T>` calls it
 * still contains. It may only SHRINK, exactly like `KNOWN_VIOLATIONS` in
 * `packages/features/src/architecture/single-writer.test.ts`:
 *
 *   - a NEW file with an asserted call fails the gate;
 *   - an existing file whose count GREW fails the gate;
 *   - a file whose count SHRANK but stayed in the manifest fails the gate, so
 *     the win cannot silently regress later.
 *
 * Keyed by file and COUNT, not by line: a line-keyed baseline churns on every
 * unrelated edit above the call, and a gate that cries wolf gets regenerated
 * reflexively, which is the same as not having one.
 *
 * DO NOT raise a count to make a new call pass. Regenerate only when it drops:
 *
 *   UPDATE_ASSERTED_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest response-derivation
 *
 * WHAT THIS GATE DOES NOT DO
 * --------------------------
 * It cannot say "a schema exists for this endpoint and you ignored it" — there
 * is no endpoint→schema map (only 4 routes carry `@ResponseContract`). And no
 * static gate can check a hand-composed projection in
 * `packages/contracts/src/responses/` against what the server really sends.
 * Column names there are anchored to GENERATED atoms, but added fields
 * (`hasGraphicMedia`, `variants`) are somebody's belief. This gate stops
 * reader-vs-schema drift. Only `apps/api/src/_integration` stops
 * schema-vs-server drift.
 */

const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'apps/api/src/architecture/response-derivation.manifest.ts'
);

const asserted = collectAssertedResponses();

function countByFile(entries: AssertedResponse[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.file, (counts.get(entry.file) ?? 0) + 1);
  }
  return counts;
}

const actual = countByFile(asserted);

function describeSites(file: string): string {
  return asserted
    .filter((a) => a.file === file)
    .map((a) => `      line ${a.line}: apiFetch<${a.typeArg}>`)
    .join('\n');
}

function rewriteBaseline(counts: Map<string, number>): void {
  const source = readFileSync(MANIFEST_PATH, 'utf8');
  const entries = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const body =
    entries.length === 0
      ? ''
      : `\n${entries.map(([file, n]) => `  '${file}': ${n},`).join('\n')}\n`;
  const declaration =
    /export const ASSERTED_BASELINE: Readonly<Record<string, number>> = \{[\s\S]*?\};\n/;
  if (!declaration.test(source)) {
    throw new Error(
      `Could not locate the ASSERTED_BASELINE declaration in ${MANIFEST_PATH}`
    );
  }
  writeFileSync(
    MANIFEST_PATH,
    source.replace(
      declaration,
      `export const ASSERTED_BASELINE: Readonly<Record<string, number>> = {${body}};\n`
    )
  );
}

const isRegenerating = process.env.UPDATE_ASSERTED_BASELINE === '1';

describe('architecture: Gate 4 — tool responses are derived, not asserted', () => {
  it('finds the tool surface at all', () => {
    // Guards against a bad refactor of the scanner silently matching nothing,
    // which would make this whole gate pass vacuously.
    expect(Object.keys(ASSERTED_BASELINE).length).toBeGreaterThan(0);
  });

  it('has no NEW file asserting a tool response', () => {
    if (isRegenerating) return;

    const newFiles = [...actual.keys()]
      .filter((file) => !(file in ASSERTED_BASELINE))
      .sort();

    if (newFiles.length > 0) {
      const sites = newFiles
        .map((f) => `  ${f}\n${describeSites(f)}`)
        .join('\n');
      throw new Error(
        `File(s) newly asserting an apiFetch response shape.

apiFetch<T> does not connect T to the endpoint — it is the caller telling the
compiler what comes back. Derive it instead:

  ctx.apiFetch(path, { schema: someResponseSchema })

If the endpoint has no schema in packages/contracts/src/responses/, add one —
that absence is the bug the assertion is hiding.

Do NOT add these to ASSERTED_BASELINE; that map only shrinks.

${sites}`
      );
    }
    expect(newFiles).toEqual([]);
  });

  it('has no file where the asserted count GREW', () => {
    if (isRegenerating) return;

    const grown = Object.entries(ASSERTED_BASELINE)
      .filter(([file, allowed]) => (actual.get(file) ?? 0) > allowed)
      .map(
        ([file, allowed]) =>
          `  ${file}: ${allowed} allowed, ${actual.get(file) ?? 0} found\n${describeSites(file)}`
      );

    if (grown.length > 0) {
      throw new Error(
        `Asserted apiFetch response(s) added to a file already on the baseline.
The baseline is a burn-down, not a budget.

${grown.join('\n')}`
      );
    }
    expect(grown).toEqual([]);
  });

  it('has no stale baseline entry (the ratchet may only shrink)', () => {
    if (isRegenerating) return;

    const stale = Object.entries(ASSERTED_BASELINE)
      .filter(([file, allowed]) => (actual.get(file) ?? 0) < allowed)
      .map(
        ([file, allowed]) =>
          `  ${file}: baseline says ${allowed}, only ${actual.get(file) ?? 0} left`
      );

    if (stale.length > 0) {
      throw new Error(
        `Asserted response(s) were derived. Lock the win in so it cannot regress:

  UPDATE_ASSERTED_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest response-derivation

${stale.join('\n')}`
      );
    }
    expect(stale).toEqual([]);
  });

  it('regenerates ASSERTED_BASELINE', () => {
    if (!isRegenerating) return;
    rewriteBaseline(actual);
    const total = [...actual.values()].reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.warn(
      `ASSERTED_BASELINE rewritten: ${actual.size} files, ${total} asserted calls. Review the diff — it must SHRINK.`
    );
    expect(total).toBeGreaterThanOrEqual(0);
  });
});
