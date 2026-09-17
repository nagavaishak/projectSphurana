/**
 * Eval runner — iterates fixtures, runs the harness, aggregates results.
 *
 * Parallel by default (`Promise.all`). Set `EVAL_SERIAL=1` to force
 * sequential execution while debugging a single recording. Pretty-prints
 * a summary table and exits non-zero on failure.
 *
 * @see ./README.md
 */

import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { type RunFixtureOptions, runFixture } from './harness.js';
import { readRecording, writeRecording } from './recording.js';
import type {
  ClaireFixture,
  EvalMode,
  FixtureCategory,
  FixtureExpectation,
  FixtureOutcome,
  FixtureTurn,
  HarnessToolStub,
  HarnessTrace,
  HarnessTurnTrace,
  RunSummary,
} from './types.js';

const CATEGORY_KEYS: FixtureCategory[] = [
  'tool-dispatch',
  'hard-block',
  'persona',
  'classifier',
  'confirmation',
  'mid-turn-skill',
  'branch-pricing',
];

/**
 * Module exported by every fixture file: a `default` `ClaireFixture` plus
 * an optional `toolStubs` array. The runner spreads both into the harness.
 */
export interface FixtureModule {
  default: ClaireFixture;
  toolStubs?: HarnessToolStub[];
}

export interface RunnerOptions {
  mode: EvalMode;
  /** When true, run fixtures one at a time. Default false. */
  serial?: boolean;
  /** Filter by fixture id substring; useful when iterating on one. */
  only?: string;
  /**
   * Restrict to these categories. Used by the HELD-OUT gate (`heldout.ts`),
   * which must run its set and nothing else — filtering by id substring would
   * silently widen the moment someone named an unrelated fixture with a
   * matching prefix.
   */
  categories?: FixtureCategory[];
  /** Override fixtures discovery for tests. When omitted, the runner
   *  globs `fixtures/*.fixture.{ts,js}`. */
  fixtureModules?: FixtureModule[];
  /** Provide a different recording IO layer for tests. Defaults to disk. */
  recordingProvider?: RunFixtureOptions['recordingProvider'];
  /** Required for record mode; passed through to the harness. */
  liveProvider?: RunFixtureOptions['liveProvider'];
  /** Where to write the human-readable summary line. Defaults to console.log. */
  log?: (line: string) => void;
}

export async function runEval(options: RunnerOptions): Promise<RunSummary> {
  const log = options.log ?? ((line: string) => console.log(line));
  const modules = options.fixtureModules ?? (await loadFixtureModules());

  // Live-controller fixtures (tools live in apps/api) can't run in the
  // in-process harness and have no replayable recording — only the
  // controller eval exercises them. Skip them here in both record and replay.
  const runnable = modules.filter(
    (m) => m.default.harness !== 'live-controller'
  );

  const byCategory = options.categories
    ? runnable.filter((m) => options.categories?.includes(m.default.category))
    : runnable;

  const filtered = options.only
    ? byCategory.filter((m) => m.default.id.includes(options.only ?? ''))
    : byCategory;

  if (filtered.length === 0) {
    log('No fixtures matched.');
    return emptySummary();
  }

  const recordingProvider = options.recordingProvider ?? {
    read: readRecording,
    write: writeRecording,
  };

  log(
    `Running ${filtered.length} fixture(s) in ${options.mode} mode${
      options.serial ? ' (serial)' : ''
    }.`
  );

  const runOne = async (mod: FixtureModule): Promise<FixtureOutcome> => {
    const startedAt = Date.now();
    const stubs = mod.toolStubs ?? [];
    let trace: HarnessTrace;
    try {
      trace = await runFixture({
        fixture: mod.default,
        toolStubs: stubs,
        mode: options.mode,
        recordingProvider,
        liveProvider: options.liveProvider,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        fixtureId: mod.default.id,
        category: mod.default.category,
        passed: false,
        failures: [`harness error: ${message}`],
        trace: { fixtureId: mod.default.id, perTurn: [] },
        durationMs: Date.now() - startedAt,
      };
    }
    const failures = compareFixture(mod.default, trace);
    return {
      fixtureId: mod.default.id,
      category: mod.default.category,
      passed: failures.length === 0,
      failures,
      trace,
      durationMs: Date.now() - startedAt,
    };
  };

  const outcomes: FixtureOutcome[] = [];
  if (options.serial) {
    for (const m of filtered) outcomes.push(await runOne(m));
  } else {
    const results = await Promise.all(filtered.map((m) => runOne(m)));
    outcomes.push(...results);
  }

  outcomes.sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));

  const summary: RunSummary = aggregate(outcomes);
  printSummary(summary, log);
  return summary;
}

// ---------------------------------------------------------------------------
// Fixture discovery
// ---------------------------------------------------------------------------

/**
 * Load every `*.fixture.{ts,js}` from the eval/fixtures/ directory. Exported
 * so external runners (e.g. the apps/api live-controller adapter CLI) can
 * pull the same set without duplicating the discovery logic.
 */
export async function loadFixtureModules(): Promise<FixtureModule[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const fixturesDir = join(here, 'fixtures');
  const entries = await readdir(fixturesDir);
  const files = entries.filter(
    (f) => f.endsWith('.fixture.ts') || f.endsWith('.fixture.js')
  );
  const modules = await Promise.all(
    files.map(async (file) => {
      const fullPath = join(fixturesDir, file);
      // pathToFileURL handles platform-specific quirks (e.g. on darwin,
      // a bare `file://${absolute}` triggers a vite/native esm warning
      // about empty host).
      const url = pathToFileURL(fullPath).href;
      const mod = (await import(url)) as Partial<FixtureModule>;
      if (!mod.default) {
        throw new Error(`Fixture file ${file} is missing a default export.`);
      }
      return { default: mod.default, toolStubs: mod.toolStubs };
    })
  );
  return modules;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/**
 * Compare a fixture's expectations against a captured trace. Returns a
 * list of human-readable failure messages; empty array means all
 * expectations passed.
 */
export function compareFixture(
  fixture: ClaireFixture,
  trace: HarnessTrace
): string[] {
  const failures: string[] = [];
  if (trace.perTurn.length !== fixture.turns.length) {
    failures.push(
      `Expected ${fixture.turns.length} turn(s); harness produced ${trace.perTurn.length}.`
    );
  }
  for (let i = 0; i < fixture.turns.length; i++) {
    const fixtureTurn = fixture.turns[i];
    const turnTrace = trace.perTurn[i];
    if (!fixtureTurn || !turnTrace) continue;
    const turnFailures = compareTurn(fixtureTurn, turnTrace, i);
    failures.push(...turnFailures);
  }
  return failures;
}

function compareTurn(
  fixtureTurn: FixtureTurn,
  turnTrace: HarnessTurnTrace,
  index: number
): string[] {
  const failures: string[] = [];
  const e: FixtureExpectation = fixtureTurn.expect;

  if (e.toolsCalled?.length) {
    const calledNames = turnTrace.toolCalls.map((c) => c.name);
    let cursor = 0;
    for (const expected of e.toolsCalled) {
      const found = calledNames.indexOf(expected, cursor);
      if (found === -1) {
        failures.push(
          `[turn ${index}] expected tool "${expected}" to be called (in order); actual sequence: [${calledNames.join(', ')}]`
        );
        break;
      }
      cursor = found + 1;
    }
  }

  if (e.hardBlockTriggered) {
    const found = turnTrace.hardBlockEvents.find(
      (h) => h.code === e.hardBlockTriggered
    );
    if (!found) {
      failures.push(
        `[turn ${index}] expected hard block "${e.hardBlockTriggered}"; got [${turnTrace.hardBlockEvents.map((h) => h.code).join(', ') || 'none'}]`
      );
    }
  }

  if (e.responseContains?.length) {
    const haystack = turnTrace.finalText.toLowerCase();
    for (const needle of e.responseContains) {
      if (!haystack.includes(needle.toLowerCase())) {
        failures.push(
          `[turn ${index}] expected response to contain "${needle}"; final text: ${shortQuote(turnTrace.finalText)}`
        );
      }
    }
  }

  if (e.responseLacks?.length) {
    const haystack = turnTrace.finalText.toLowerCase();
    for (const needle of e.responseLacks) {
      if (haystack.includes(needle.toLowerCase())) {
        failures.push(
          `[turn ${index}] expected response NOT to contain "${needle}"; final text: ${shortQuote(turnTrace.finalText)}`
        );
      }
    }
  }

  if (e.skillsLoaded?.length) {
    for (const skillId of e.skillsLoaded) {
      if (!turnTrace.loadedSkillIdsAtEnd.includes(skillId)) {
        failures.push(
          `[turn ${index}] expected skill "${skillId}" to be loaded by end of turn; loaded: [${turnTrace.loadedSkillIdsAtEnd.join(', ')}]`
        );
      }
    }
  }

  // ---- decision assertions ------------------------------------------------
  // These read tool INPUTS and RESULTS, which the trace has always carried and
  // nothing above ever looked at.

  if (e.toolsNotCalled?.length) {
    const calledNames = turnTrace.toolCalls.map((c) => c.name);
    for (const banned of e.toolsNotCalled) {
      if (calledNames.includes(banned)) {
        failures.push(
          `[turn ${index}] tool "${banned}" must NOT be called; actual sequence: [${calledNames.join(', ')}]`
        );
      }
    }
  }

  if (e.toolFailed) {
    const { name, code } = e.toolFailed;
    const call = turnTrace.toolCalls.find((c) => c.name === name);
    if (!call) {
      failures.push(
        `[turn ${index}] expected tool "${name}" to be called and FAIL; it was not called at all. Called: [${turnTrace.toolCalls.map((c) => c.name).join(', ') || 'none'}]`
      );
    } else if (call.result?.ok !== false) {
      failures.push(
        `[turn ${index}] expected tool "${name}" to return a FAILURE; it returned ok. This fixture's stub is wrong, so the relay assertion below proves nothing.`
      );
    } else if (code && call.result.code !== code) {
      failures.push(
        `[turn ${index}] expected tool "${name}" to fail with code "${code}"; got "${call.result.code ?? 'undefined'}"`
      );
    }
  }

  if (e.claimsRequireToolSupport?.length) {
    const haystack = turnTrace.finalText.toLowerCase();
    // One JSON blob of every result Claire actually read this turn.
    const resultsJson = JSON.stringify(
      turnTrace.toolCalls.map((c) => c.result ?? null)
    ).toLowerCase();

    for (const { phrase, support } of e.claimsRequireToolSupport) {
      if (!haystack.includes(phrase.toLowerCase())) continue;
      if (resultsJson.includes(support.toLowerCase())) continue;
      failures.push(
        `[turn ${index}] response claims "${phrase}" but NO tool result this turn contains "${support}" — the claim is unsupported by anything Claire read. Final text: ${shortQuote(turnTrace.finalText)}`
      );
    }
  }

  if (e.confirmationPresented) {
    const found = turnTrace.confirmationEvents.find(
      (c) => c.action === e.confirmationPresented
    );
    if (!found) {
      failures.push(
        `[turn ${index}] expected confirmation "${e.confirmationPresented}"; got [${turnTrace.confirmationEvents.map((c) => c.action).join(', ') || 'none'}]`
      );
    }
  }

  return failures;
}

function shortQuote(text: string, max = 200): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return JSON.stringify(trimmed);
  return `${JSON.stringify(`${trimmed.slice(0, max)}…`)} (${trimmed.length} chars)`;
}

// ---------------------------------------------------------------------------
// Aggregation + reporting
// ---------------------------------------------------------------------------

function emptySummary(): RunSummary {
  const byCategory: RunSummary['byCategory'] = {} as RunSummary['byCategory'];
  for (const c of CATEGORY_KEYS) byCategory[c] = { passed: 0, failed: 0 };
  return { total: 0, passed: 0, failed: 0, byCategory, outcomes: [] };
}

function aggregate(outcomes: FixtureOutcome[]): RunSummary {
  const summary = emptySummary();
  for (const outcome of outcomes) {
    summary.total++;
    if (outcome.passed) summary.passed++;
    else summary.failed++;
    summary.byCategory[outcome.category][
      outcome.passed ? 'passed' : 'failed'
    ]++;
  }
  summary.outcomes = outcomes;
  return summary;
}

function printSummary(summary: RunSummary, log: (line: string) => void): void {
  log('');
  log('Eval summary');
  log('────────────');
  for (const c of CATEGORY_KEYS) {
    const stats = summary.byCategory[c];
    const total = stats.passed + stats.failed;
    if (total === 0) continue;
    const tag = stats.failed === 0 ? '✓' : '✗';
    log(`  ${tag} ${c.padEnd(18)} ${stats.passed}/${total} passed`);
  }
  log('────────────');
  const tag = summary.failed === 0 ? '✓' : '✗';
  log(`  ${tag} total              ${summary.passed}/${summary.total} passed`);

  if (summary.failed > 0) {
    log('');
    log('Failures');
    log('────────');
    for (const o of summary.outcomes) {
      if (o.passed) continue;
      log(`  ✗ ${o.fixtureId} (${o.category})`);
      for (const f of o.failures) log(`      - ${f}`);
    }
  }
}
