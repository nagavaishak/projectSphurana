import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { REGISTERED_FORMS } from './registry';

/**
 * The ratchet. Coverage can only grow.
 *
 * The harness is only as good as the registry it runs over, so this guards the
 * registry itself: every entry has its shared core and its contract spec on
 * disk, no two entries claim the same operation, no contract spec exists that
 * nobody registered, and the number of registered forms never goes down.
 *
 * Adding a second surface to an operation therefore forces you to register it
 * and write its contract — which is what makes coverage self-maintaining rather
 * than "the forms we happened to remember".
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = resolve(appRoot, 'src');

/**
 * Registered forms today. RATCHET: raise this as forms are added, never lower
 * it. Lowering it means a form lost its contract.
 */
const BASELINE_REGISTERED = 41;

/**
 * Operations with no user-facing form (they skip properties 1 and 2). RATCHET:
 * lower this as they grow forms; never raise it.
 */
const BASELINE_NO_FORM = 5;

function findContractSpecs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      findContractSpecs(full, acc);
    } else if (
      entry.name.endsWith('.contract.test.tsx') &&
      // `src/features/*/contracts/` holds RESPONSE contracts (the API-response
      // parse gates) — a different thing that happens to share the suffix.
      !full.includes(`${sep}contracts${sep}`)
    ) {
      acc.push(relative(appRoot, full));
    }
  }
  return acc;
}

describe('form-contract coverage', () => {
  it.each(REGISTERED_FORMS)(
    '"$operation" has its shared core and its contract spec on disk',
    (form) => {
      expect(
        existsSync(resolve(appRoot, form.sharedCore)),
        `${form.operation}: sharedCore not found at ${form.sharedCore}`
      ).toBe(true);
      expect(
        existsSync(resolve(appRoot, form.contract)),
        `${form.operation}: contract spec not found at ${form.contract}`
      ).toBe(true);
    }
  );

  it('registers no operation twice', () => {
    const ops = REGISTERED_FORMS.map((f) => f.operation);
    const dupes = ops.filter((op, i) => ops.indexOf(op) !== i);
    expect(dupes, `duplicate operations: ${dupes.join(', ')}`).toEqual([]);
  });

  it('has no orphan contract spec (every spec on disk is registered)', () => {
    const registered = new Set(REGISTERED_FORMS.map((f) => f.contract));
    const orphans = findContractSpecs(srcRoot).filter(
      (spec) => !registered.has(spec)
    );
    expect(
      orphans,
      `These contract specs exist but no registry entry points at them, so nothing\nguards them against deletion. Register them in registry.ts:\n${orphans.map((f) => `  - ${f}`).join('\n')}`
    ).toEqual([]);
  });

  it('form-less operations stay rare (they skip properties 1 and 2)', () => {
    const formless = REGISTERED_FORMS.filter((f) => f.noForm);
    expect(
      formless.length,
      `${formless.length} operations declare \`noForm\` and so skip properties 1 and 2:\n${formless.map((f) => `  - ${f.operation}: ${f.noForm}`).join('\n')}\n\nThat is legitimate for a body built from window.location or from a clicked row,\nbut it is NOT an escape hatch for a form that is merely awkward to drive. If one of\nthese grew a form, give it a defineForm declaration and drop the flag.`
    ).toBeLessThanOrEqual(BASELINE_NO_FORM);
  });

  it('coverage only grows (raise BASELINE_REGISTERED, never lower it)', () => {
    expect(
      REGISTERED_FORMS.length,
      `The registry has ${REGISTERED_FORMS.length} forms but the ratchet expects at least\n` +
        `${BASELINE_REGISTERED}. A form lost its contract. Restore it — do not lower the baseline.`
    ).toBeGreaterThanOrEqual(BASELINE_REGISTERED);
  });
});
