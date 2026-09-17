import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The ads list must send every field its contract declares.
 *
 * `listAds` builds its rows with an explicit drizzle projection. That is the
 * right shape — but a column left out of it is not sent AT ALL, and JSON has
 * no way to say "absent": the browser gets `undefined` where `adSchema`
 * promised a value, `api-client` logs a ZodError, and the app carries on with
 * a hole in the row.
 *
 * Twelve columns were missing this way, and the damage was worse than the log.
 * A consumer reading `ad.useExistingPost` got `undefined`, which is falsy, so
 * an ad running an existing page post was indistinguishable from an ordinary
 * one — the ad panel offered to swap its creative and the server refused. The
 * same trap sat under `leadFormId` (which locks the destination fields) and
 * `destinations`.
 *
 * Comparing the SOURCE against the contract, rather than a response object,
 * is deliberate: the failure is a column that was never asked for, so there is
 * no row to inspect. This reads the projection the way the reviewer would.
 */
const here = dirname(fileURLToPath(import.meta.url));

function readSource(relative: string): string {
  return readFileSync(join(here, relative), 'utf8');
}

/** Field names declared by the generated `meta_ad` atom. */
function contractFields(): string[] {
  const atom = readSource('../../../../../contracts/src/generated/metaAd.ts');
  return [...atom.matchAll(/^ {2}(\w+):/gm)].map((m) => m[1]);
}

/** Columns the list projection actually selects off `metaAd`. */
function projectedFields(): Set<string> {
  const service = readSource('./list-ads.service.ts');
  const block = service.split('.select({')[1]?.split('})')[0] ?? '';
  return new Set([...block.matchAll(/^\s+(\w+): metaAd\./gm)].map((m) => m[1]));
}

describe('listAds wire projection', () => {
  it('selects every field adSchema declares', () => {
    const projected = projectedFields();
    const missing = contractFields().filter((f) => !projected.has(f));

    expect(
      missing,
      missing.length === 0
        ? ''
        : `\nThese fields are declared by the meta_ad contract but never selected, so they reach the browser as \`undefined\`:\n${missing
            .map((f) => `  - ${f}`)
            .join(
              '\n'
            )}\nAdd them to the projection in list-ads.service.ts (see this file's header for why a missing key is worse than a null).\n`
    ).toEqual([]);
  });

  it('reads a projection at all — the parse must not silently pass', () => {
    // If `.select({` ever moves or is renamed, `projectedFields()` returns an
    // empty set and the assertion above would report EVERY field as missing
    // rather than quietly passing. Pin the parse so a green run means the
    // check actually ran.
    expect(projectedFields().size).toBeGreaterThan(20);
    expect(contractFields().length).toBeGreaterThan(20);
  });
});
