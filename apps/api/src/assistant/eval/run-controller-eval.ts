/**
 * Live-controller eval CLI.
 *
 * Loads the same `*.fixture.ts` files the in-process harness uses, runs each
 * through the live controller pipeline (`runToolLoop` + `emitUIStreamEvent`),
 * captures the SSE byte stream, parses it back, and compares against the
 * fixture's `expect` block via `compareFixture` (re-used from the features
 * package — same comparison logic as in-process mode).
 *
 * **Mode** — only `record` is supported in v1; the live API is the source of
 * truth (replay-from-recorded-SSE-stream is a follow-up). `ANTHROPIC_API_KEY`
 * is required.
 *
 * Env knobs (mirror the in-process runner):
 *   - `EVAL_FILTER=<substring>` — only run fixtures whose ID contains this
 *   - `EVAL_SERIAL=1`           — run sequentially (default is parallel)
 *
 * @see ./controller-pipeline-adapter.ts
 * @see packages/features/src/assistant/eval/run-eval.ts (the in-process CLI)
 */

import {
  type FixtureModule,
  type FixtureOutcome,
  compareFixture,
  loadFixtureModules,
} from '@borradh-workspace/features/assistant';
import { runFixtureViaController } from './controller-pipeline-adapter.js';

const CATEGORY_KEYS = [
  'tool-dispatch',
  'hard-block',
  'persona',
  'classifier',
  'confirmation',
  'mid-turn-skill',
  'branch-pricing',
] as const;

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(
      'Live-controller eval requires ANTHROPIC_API_KEY. Use `pnpm test:eval-claire` for keyless in-process replay.'
    );
    process.exit(2);
  }

  const filter = process.env.EVAL_FILTER || undefined;
  const serial = process.env.EVAL_SERIAL === '1';

  const modules = await loadFixtureModules();
  const filtered = filter
    ? modules.filter((m) => m.default.id.includes(filter))
    : modules;

  if (filtered.length === 0) {
    console.log('No fixtures matched.');
    process.exit(0);
  }

  console.log(
    `Running ${filtered.length} fixture(s) via live-controller pipeline${
      serial ? ' (serial)' : ''
    }.`
  );

  const runOne = async (mod: FixtureModule): Promise<FixtureOutcome> => {
    const startedAt = Date.now();
    try {
      const trace = await runFixtureViaController({
        fixture: mod.default,
        toolStubs: mod.toolStubs ?? [],
        mode: 'record',
      });
      const failures = compareFixture(mod.default, trace);
      return {
        fixtureId: mod.default.id,
        category: mod.default.category,
        passed: failures.length === 0,
        failures,
        trace,
        durationMs: Date.now() - startedAt,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        fixtureId: mod.default.id,
        category: mod.default.category,
        passed: false,
        failures: [`controller-pipeline error: ${message}`],
        trace: { fixtureId: mod.default.id, perTurn: [] },
        durationMs: Date.now() - startedAt,
      };
    }
  };

  const outcomes: FixtureOutcome[] = [];
  if (serial) {
    for (const m of filtered) outcomes.push(await runOne(m));
  } else {
    const results = await Promise.all(filtered.map((m) => runOne(m)));
    outcomes.push(...results);
  }

  outcomes.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
  printSummary(outcomes);
  const failed = outcomes.filter((o) => !o.passed).length;
  process.exit(failed === 0 ? 0 : 1);
}

function printSummary(outcomes: FixtureOutcome[]): void {
  console.log('');
  console.log('Live-controller eval summary');
  console.log('────────────────────────────');
  for (const c of CATEGORY_KEYS) {
    const inCat = outcomes.filter((o) => o.category === c);
    if (inCat.length === 0) continue;
    const passed = inCat.filter((o) => o.passed).length;
    const tag = passed === inCat.length ? '✓' : '✗';
    console.log(`  ${tag} ${c.padEnd(18)} ${passed}/${inCat.length} passed`);
  }
  console.log('────────────────────────────');
  const passed = outcomes.filter((o) => o.passed).length;
  const tag = passed === outcomes.length ? '✓' : '✗';
  console.log(
    `  ${tag} total              ${passed}/${outcomes.length} passed`
  );

  const failures = outcomes.filter((o) => !o.passed);
  if (failures.length > 0) {
    console.log('');
    console.log('Failures');
    console.log('────────');
    for (const o of failures) {
      console.log(`  ✗ ${o.fixtureId} (${o.category})`);
      for (const f of o.failures) console.log(`      - ${f}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
