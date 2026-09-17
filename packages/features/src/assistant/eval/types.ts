/**
 * Claire eval-harness types.
 *
 * The harness composes the in-package pieces of the controller flow —
 * orchestrator + skills + classifier — and drives them against a recorded
 * transcript. Tool execution is **simulated** from fixture stubs because the
 * factory (`apps/api/src/assistant/tool-factory/`) lives outside this
 * package; the structural trace the harness verifies (which tools fired in
 * which order, what presentation envelopes came back, what skills were
 * loaded) is all the prep harness needs.
 *
 * The live-controller adapter ships in W-C04-A-finish.
 *
 * @see docs/implementations/claire-briefs/window-c04-a-prep.md
 */

import type { AssistantContext } from '../services/get-context/get-context.service.js';

/**
 * A test case the harness runs end-to-end. Fixtures live as `*.fixture.ts`
 * files and are loaded by `runner.ts`.
 *
 * Fixtures are pure data — never import LLM clients or Anthropic SDK from
 * a fixture.
 */
export interface ClaireFixture {
  /**
   * Stable, slug-cased ID. Used as the recording filename
   * (`recordings/<id>.json`) and as the test name in the runner output.
   */
  id: string;
  description: string;
  /**
   * Loose category for at-a-glance reporting. Doesn't affect harness
   * behaviour — the runner uses it to group the summary table.
   */
  category: FixtureCategory;
  /**
   * Which harness can run this fixture. Defaults to `in-process` (the keyless
   * replay harness in this package). Set to `live-controller` for fixtures
   * whose tools live in `apps/api` (e.g. the `claire_setPendingAd*` builder
   * tools) and can therefore only be exercised via the live-controller eval
   * (`apps/api/src/assistant/eval/run-controller-eval.ts`). The in-process
   * runner skips these — they have no replayable recording — while the
   * controller eval runs them.
   */
  harness?: 'in-process' | 'live-controller';
  setup?: FixtureSetup;
  turns: FixtureTurn[];
}

export type FixtureCategory =
  | 'tool-dispatch'
  | 'hard-block'
  | 'persona'
  | 'classifier'
  | 'confirmation'
  | 'mid-turn-skill'
  /**
   * HELD OUT. Branch-scoped pricing (location redesign §3.3). Run as its own
   * gate by `heldout.ts` and deliberately not tuned against during prompt work
   * — see that file for what "held out" buys and what it does not.
   */
  | 'branch-pricing';

export interface FixtureSetup {
  /**
   * Partial override of the org context used as `AssistantContext` input
   * to `buildOrchestratorPrompt`. Anything not overridden falls back to
   * `DEFAULT_ORG_CONTEXT` in `harness.ts`.
   */
  orgContextOverrides?: Partial<AssistantContext>;
  /**
   * Pre-load specific skill IDs and skip the classifier on the first turn.
   * Useful for fixtures that target a specific skill's behaviour without
   * coupling the assertion to classifier accuracy.
   */
  initialLoadedSkillIds?: string[];
}

export interface FixtureTurn {
  userMessage: string;
  expect: FixtureExpectation;
}

/**
 * What the harness should observe by the end of a turn. Every field is
 * optional so fixtures can scope tightly: e.g. a persona fixture might
 * only assert `responseContains` / `responseLacks` and ignore tool calls.
 *
 * Match semantics:
 *
 *   - `toolsCalled` — array of tool names that must appear in the trace,
 *     in this order. Other tool calls between them are tolerated.
 *   - `hardBlockTriggered` — code of a `hard_block_violation` presentation
 *     that must appear at least once in the trace.
 *   - `responseContains` / `responseLacks` — substring search on the
 *     final assistant text (case-insensitive).
 *   - `skillsLoaded` — every listed skill ID must end up in
 *     `loadedSkillIds` by the end of the turn.
 *   - `confirmationPresented` — a `confirmation_required` presentation
 *     for this action must appear at least once.
 *
 * The three keys below assert DECISIONS rather than plumbing. Everything above
 * passes as long as the wiring works: which tool fired, which envelope came
 * back, which skill loaded. None of it can fail when Claire dispatches
 * perfectly to the WRONG tool, or narrates a result no tool returned — and
 * that class is ~51% of the production audit's 717 defect findings (behaviour
 * 50.6%, product bug 23.3%, missing feature 13.2%). The trace already carried
 * tool INPUTS and tool RESULTS; nothing read them.
 */
export interface FixtureExpectation {
  toolsCalled?: string[];
  hardBlockTriggered?: string;
  responseContains?: string[];
  responseLacks?: string[];
  skillsLoaded?: string[];
  confirmationPresented?: string;

  /**
   * Tools that must NOT be called this turn.
   *
   * `toolsCalled` is a positive subsequence match and TOLERATES extra calls, so
   * it cannot express "chose the wrong one". The audit's headline behavioural
   * defect is exactly that shape: `create` called 158x where `regenerate` was
   * correct — both dispatch fine, and every existing assertion stays green.
   */
  toolsNotCalled?: string[];

  /**
   * A tool result that must have FAILED this turn — the refusal side of a
   * relay check. Pair with `responseLacks` to assert Claire did not report a
   * refusal as a success.
   *
   * `code` is optional; when given, the failing result's `code` must match.
   */
  toolFailed?: { name: string; code?: string };

  /**
   * Phrases that may not appear in the final text unless SOME tool result this
   * turn actually supports them.
   *
   * `support` is a substring searched in the JSON of every tool result in the
   * turn. If `phrase` appears in Claire's prose and `support` appears in no
   * tool result, the turn fails. This is the "asserted state it never read
   * back" class: the `silent-wrong` + `capability-lie` categories, 69 of the
   * audit's findings between them.
   *
   * Deliberately NOT a general hallucination detector — it catches enumerated
   * claims, which is what a fixture can assert deterministically in replay
   * mode without an LLM judge in the comparator.
   */
  claimsRequireToolSupport?: { phrase: string; support: string }[];
}

/**
 * A simulated tool result. Mirrors the live `ToolResult<unknown>` shape from
 * `apps/api/src/assistant/tool-factory/types.ts` but is reproduced here so
 * the features-package harness doesn't reach into apps/api. The structure
 * is what the model sees as `tool_result` content.
 */
export type HarnessToolResult =
  | { ok: true; data?: unknown; presentation?: HarnessPresentation }
  | {
      ok: false;
      error: string;
      code?: string;
      presentation?: HarnessPresentation;
    };

export type HarnessPresentation =
  | {
      type: 'confirmation_required';
      action: string;
      resourceId: string;
      token: string;
      expiresAt: string;
      summary?: { title?: string; fields?: { label: string; value: string }[] };
      executeToolName: string;
      renderer?: string;
    }
  | {
      type: 'confirmation_expired';
      reason:
        | 'expired'
        | 'consumed'
        | 'mismatch'
        | 'not_found'
        | 'no_user_turn';
    }
  | { type: 'hard_block_violation'; code: string; message: string }
  | {
      type: 'tour_dispatch';
      tourKind: string;
      payload?: Record<string, unknown>;
      navigateTo: string;
    };

/**
 * Closed-set predicate matching the harness's narrow targets. Other
 * presentation shapes (added by future tools) are tolerated by the runtime
 * but not surfaced into trace-level events until the harness is taught
 * about them.
 */
export const KNOWN_PRESENTATION_TYPES = [
  'confirmation_required',
  'confirmation_expired',
  'hard_block_violation',
  'tour_dispatch',
] as const;

/**
 * Capture of one full conversation, populated by the harness. Compared
 * against the fixture's per-turn expectations. The runner serializes a
 * subset of this on failure so authors can see what actually happened.
 */
export interface HarnessTrace {
  fixtureId: string;
  perTurn: HarnessTurnTrace[];
}

export interface HarnessTurnTrace {
  userMessage: string;
  classifierCall?: { skillIds: string[]; confidence: number };
  loadedSkillIdsAtStart: string[];
  loadedSkillIdsAtEnd: string[];
  toolCalls: HarnessToolCall[];
  hardBlockEvents: { code: string; message: string; toolName: string }[];
  confirmationEvents: {
    action: string;
    resourceId: string;
    toolName: string;
  }[];
  skillLoadEvents: { skillId: string }[];
  finalText: string;
  rounds: number;
}

export interface HarnessToolCall {
  name: string;
  input: unknown;
  result: HarnessToolResult;
}

/**
 * On-disk recording. Replay mode reads these; live mode (EVAL_RECORD=1)
 * writes them. Versioned so we can evolve the format without silently
 * breaking old recordings.
 */
export interface HarnessRecording {
  version: 1;
  fixtureId: string;
  recordedAt: string;
  /** Skill registry version at record time — surfaces drift in CI. */
  skillRegistryVersion: number;
  turns: RecordedTurn[];
}

export interface RecordedTurn {
  userMessage: string;
  /** Optional — the classifier only runs on turn 1 (or never if a fixture's
   *  `initialLoadedSkillIds` is set). */
  classifierResponse?: { skillIds: string[]; confidence: number };
  rounds: RecordedRound[];
}

export interface RecordedRound {
  /** Free text the model emits in this round. Only the LAST round's text
   *  is treated as the final assistant response; earlier rounds typically
   *  emit nothing or short progress text. */
  modelText: string;
  toolUses: RecordedToolUse[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'pause_turn';
}

export interface RecordedToolUse {
  /** The tool name the model called. Must match one of the available tools
   *  for the current `loadedSkillIds`, plus the always-loaded meta tools
   *  (`meta_loadSkill`, `meta_dispatchTour`). */
  name: string;
  input: Record<string, unknown>;
  /** The tool_result the harness fed back to the model after this call.
   *  In live mode, this comes from the fixture's tool stubs. In replay
   *  mode, this is read verbatim. */
  result: HarnessToolResult;
}

/**
 * Per-fixture stubs that simulate tool execution. The runner accepts a
 * map keyed on tool name; the harness invokes the matching stub when the
 * model issues a `tool_use` block.
 *
 * In live mode, these are the only knobs that drive deterministic results
 * — the model itself is non-deterministic but the data it sees is fixed.
 */
export interface HarnessToolStub {
  name: string;
  /** When set, marks the stub as destructive. The harness emits a
   *  synthetic `confirmation_required` presentation on the FIRST call
   *  (without a `confirmationToken`); on the SECOND call (with one), it
   *  invokes `respond`. Mirrors the factory's two-call confirmation flow. */
  destructive?: boolean;
  destructiveAction?: string;
  /** When `destructive: true` and the model's input matches one of the
   *  validator names listed here, the harness emits a synthetic
   *  `hard_block_violation` presentation instead of a confirmation
   *  required. Each validator is a pure function over the proposed input. */
  hardBlockChecks?: HarnessHardBlockCheck[];
  /** Build a confirmation summary on first call. Required if
   *  `destructive: true`. */
  summarizeForConfirmation?: (input: Record<string, unknown>) => {
    title?: string;
    fields?: { label: string; value: string }[];
    resourceId: string;
  };
  /** Tool implementation — invoked on a non-destructive call, OR on the
   *  second (token-bearing) call of a destructive tool. */
  respond: (
    input: Record<string, unknown>,
    callIndex: number
  ) => HarnessToolResult;
}

export interface HarnessHardBlockCheck {
  /** Validator name, e.g. `'noFabricatedResultClaims'`. Mirrors the names
   *  in `apps/api/src/assistant/tool-factory/hard-blocks.ts`. */
  code: string;
  /** Pure check — return null to pass, return a message to fail. */
  evaluate: (input: Record<string, unknown>) => string | null;
}

/**
 * Public outcome of running a single fixture. Aggregated by the runner.
 */
export interface FixtureOutcome {
  fixtureId: string;
  category: FixtureCategory;
  passed: boolean;
  /** Human-readable failure reasons. One per failed expectation. */
  failures: string[];
  trace: HarnessTrace;
  durationMs: number;
}

/**
 * Aggregate run summary written to stdout + exit code = 0/1.
 */
export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  byCategory: Record<FixtureCategory, { passed: number; failed: number }>;
  outcomes: FixtureOutcome[];
}

/**
 * Mode the runner operates in.
 *
 *   - `replay`: read recordings from disk; do NOT call Anthropic.
 *     Default in CI.
 *   - `record`: call real Anthropic; on success, OVERWRITE the
 *     fixture's recording on disk. Requires `ANTHROPIC_API_KEY`.
 *
 * `EVAL_RECORD=1` env flag toggles record mode at the runner CLI.
 */
export type EvalMode = 'replay' | 'record';
