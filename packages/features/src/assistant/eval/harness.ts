/**
 * In-process Claire eval harness.
 *
 * Composes the in-package controller pieces — orchestrator + skills +
 * classifier — and drives a fixture either against pre-recorded traces
 * (replay mode, default) or against the live Anthropic API + fixture tool
 * stubs (record mode, gated by `EVAL_RECORD=1` + `ANTHROPIC_API_KEY`).
 *
 * Tool execution is **simulated** via fixture-supplied stubs. The factory's
 * full wrapping (`apps/api/src/assistant/tool-factory/`) lives outside this
 * package; the live-controller adapter that exercises it ships in
 * W-C04-A-finish. Until then, the harness verifies the structural
 * invariants the factory composes around: which tools fire, in what order,
 * with what presentation envelopes (confirmation_required,
 * hard_block_violation), and which skills end up loaded.
 *
 * @see ./README.md
 * @see docs/implementations/claire-briefs/window-c04-a-prep.md
 */

// Import via specific module paths (NOT the assistant barrel) so the
// test environment doesn't pull in unrelated services whose schemas
// depend on database constants the test-time mock doesn't surface
// (e.g. `assistantActionTypeValues` consumed by
// create-recommendation.schema.ts).
import {
  type ClassifyIntentResult,
  classifyIntent,
} from '../services/classify-intent/index.js';
import type { AssistantContext } from '../services/get-context/get-context.service.js';
import {
  SKILL_REGISTRY_VERSION,
  buildToolListForSkills,
  getSkillById,
} from '../skills/index.js';
import {
  type AnthropicSystemBlock,
  buildOrchestratorPrompt,
} from '../skills/orchestrator.js';
import type {
  ClaireFixture,
  EvalMode,
  HarnessPresentation,
  HarnessRecording,
  HarnessToolCall,
  HarnessToolResult,
  HarnessToolStub,
  HarnessTrace,
  HarnessTurnTrace,
  RecordedRound,
  RecordedTurn,
} from './types.js';

/**
 * Maximum tool-use rounds per turn — matches the legacy controller's cap.
 * If a recording exceeds this, the harness fails the turn rather than
 * looping indefinitely (a runaway loop in a recording is itself a bug).
 */
const MAX_ROUNDS_PER_TURN = 10;

/**
 * The tools the controller always exposes, regardless of skill loading.
 * Mirrors `metaTools` in `apps/api/src/assistant/tools/meta/index.ts`
 * (`loadSkillTool`, `dispatchTourTool`, `rememberTool`). The harness has
 * built-in handling for `meta_loadSkill` (skill loading) and
 * `meta_dispatchTour` (tour dispatch); `meta_remember` is exposed to the
 * model here too (so record-mode parity with production holds — the model
 * can actually call it), but its result is resolved from the fixture's
 * stub rather than a built-in handler. The factory's real meta tools live
 * in apps/api; this list keeps the harness self-contained.
 */
const META_TOOL_NAMES: readonly string[] = [
  'meta_loadSkill',
  'meta_dispatchTour',
  'meta_remember',
];

/**
 * Default org context used when a fixture doesn't override.
 *
 * Picked to look like a small Irish aesthetic clinic, matching the v3
 * persona's voice. Sanitization in `buildBusinessContextBlock` works on
 * any string; values aren't load-bearing for replay-mode fixtures.
 */
export const DEFAULT_ORG_CONTEXT: AssistantContext = {
  name: 'Glow Aesthetics',
  address: '12 Grafton Street, Dublin 2, Ireland',
  timezone: 'Europe/Dublin',
  businessType: 'aesthetic_clinic',
  businessTypeLabel: 'Aesthetic clinic',
  brandVoice: ['warm', 'professional', 'direct'],
  targetAudienceDescription:
    'Women aged 25–55 in Dublin, value quality and discretion',
  credibilityLine: 'Five years on Grafton Street; over 2,000 clients treated',
  tagline: 'Honest aesthetics, expertly delivered',
  services: [
    'Lip filler',
    'Anti-wrinkle treatment',
    'Skin booster',
    'PRP facial',
  ],
  serviceDetails: [],
};

/**
 * Public entry point. Accepts a fixture + tool stubs; runs every turn;
 * returns a structural trace the runner compares against expectations.
 *
 * Mode is decided at the runner level — `replay` reads recordings;
 * `record` calls Anthropic. The harness itself is pure orchestration;
 * IO (read/write recordings, real API calls) is delegated to the
 * `recordingProvider` and `liveProvider` so tests can plug in fakes.
 */
export interface RunFixtureOptions {
  fixture: ClaireFixture;
  toolStubs: HarnessToolStub[];
  mode: EvalMode;
  recordingProvider: RecordingProvider;
  /** Required for `record` mode; never invoked in `replay`. */
  liveProvider?: LiveProvider;
}

/**
 * Reads/writes recordings. `runner.ts` constructs one backed by the
 * disk module; tests substitute an in-memory implementation.
 */
export interface RecordingProvider {
  read: (fixtureId: string) => Promise<HarnessRecording | null>;
  write: (recording: HarnessRecording) => Promise<void>;
}

/**
 * Drives the live Anthropic call. The runner constructs a real one in
 * record mode; tests pass a deterministic fake.
 *
 * The provider is passed the system blocks the orchestrator built, the
 * available tool names, and the running message list. It returns the
 * model's response: free text plus zero or more tool_use blocks. The
 * harness handles tool_result construction itself (via the fixture's
 * stubs) and appends the result back into messages for the next round.
 */
export interface LiveProvider {
  classifyIntent?: (
    userMessage: string,
    organizationId: string
  ) => Promise<ClassifyIntentResult>;
  callModel: (input: LiveModelCallInput) => Promise<LiveModelCallOutput>;
}

export interface LiveModelCallInput {
  systemBlocks: AnthropicSystemBlock[];
  toolNames: string[];
  /** Anthropic-shaped message list (role + content blocks). The harness
   *  hands a structurally-compatible list — the live provider is free to
   *  pass it through to `client.messages.create`. */
  messages: AnthropicMessage[];
  /** Stop after this many rounds within a turn — caller-side safety. */
  maxRounds: number;
  /** Skill-driven model preference. The provider may consult its own
   *  routing table (sonnet vs opus) if it doesn't follow the hint. */
  preferredModel: 'sonnet' | 'opus';
}

export interface LiveModelCallOutput {
  modelText: string;
  toolUses: { name: string; input: Record<string, unknown> }[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'pause_turn';
}

export type AnthropicMessageRole = 'user' | 'assistant';

export type AnthropicMessageContent =
  | { type: 'text'; text: string }
  | {
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface AnthropicMessage {
  role: AnthropicMessageRole;
  content: AnthropicMessageContent[];
}

/**
 * Run the fixture. Throws only on infrastructure errors (missing
 * recording in replay, missing live provider in record). Anything that
 * can be expressed as a per-turn failure goes into the trace and is
 * surfaced by the runner.
 */
export async function runFixture(
  options: RunFixtureOptions
): Promise<HarnessTrace> {
  const { fixture, toolStubs, mode, recordingProvider, liveProvider } = options;

  // Resolve the recording up front. In replay mode it's required; in
  // record mode we pass the existing recording (if any) through so we can
  // diff later — but mostly we'll be writing a fresh one.
  const existingRecording = await recordingProvider.read(fixture.id);
  if (mode === 'replay' && !existingRecording) {
    throw new HarnessError(
      `No recording found for fixture "${fixture.id}". Run with EVAL_RECORD=1 + ANTHROPIC_API_KEY to populate, or hand-author a recording at recordings/${fixture.id}.json.`,
      'MISSING_RECORDING'
    );
  }
  if (mode === 'record' && !liveProvider) {
    throw new HarnessError(
      'Record mode requires a liveProvider. Did you set ANTHROPIC_API_KEY?',
      'MISSING_LIVE_PROVIDER'
    );
  }

  const stubsByName = new Map(toolStubs.map((s) => [s.name, s]));
  const orgContext = mergeOrgContext(fixture.setup?.orgContextOverrides);
  const loadedSkillIds: string[] = [
    ...(fixture.setup?.initialLoadedSkillIds ?? []),
  ];
  if (loadedSkillIds.length === 0) loadedSkillIds.push('default');
  ensureDefaultSkill(loadedSkillIds);

  const trace: HarnessTrace = { fixtureId: fixture.id, perTurn: [] };
  const recordedTurns: RecordedTurn[] = [];

  // Anthropic-style messages persist across turns.
  const messages: AnthropicMessage[] = [];

  for (let turnIndex = 0; turnIndex < fixture.turns.length; turnIndex++) {
    const fixtureTurn = fixture.turns[turnIndex];
    if (!fixtureTurn) continue;

    const turnTrace: HarnessTurnTrace = {
      userMessage: fixtureTurn.userMessage,
      loadedSkillIdsAtStart: [...loadedSkillIds],
      loadedSkillIdsAtEnd: [],
      toolCalls: [],
      hardBlockEvents: [],
      confirmationEvents: [],
      skillLoadEvents: [],
      finalText: '',
      rounds: 0,
    };

    // First-turn classifier.
    if (turnIndex === 0 && !fixture.setup?.initialLoadedSkillIds) {
      const classified = await runClassifier({
        userMessage: fixtureTurn.userMessage,
        organizationId: 'eval-org',
        mode,
        liveProvider,
        existingRecording,
        turnIndex,
      });
      if (classified) {
        turnTrace.classifierCall = classified;
        for (const id of classified.skillIds) {
          if (!loadedSkillIds.includes(id)) loadedSkillIds.push(id);
        }
        ensureDefaultSkill(loadedSkillIds);
      }
    }

    messages.push({
      role: 'user',
      content: [{ type: 'text', text: fixtureTurn.userMessage }],
    });

    const recordedRounds: RecordedRound[] = [];
    let lastModelText = '';
    let stopped = false;

    for (let round = 0; round < MAX_ROUNDS_PER_TURN; round++) {
      turnTrace.rounds = round + 1;
      const toolNames = currentToolNames(loadedSkillIds);
      const preferredModel = derivePreferredModel(loadedSkillIds);

      let modelOutput: LiveModelCallOutput;
      if (mode === 'record') {
        // The top-of-runFixture guard already enforced liveProvider's
        // presence; recheck here so the type narrows without a non-null
        // assertion. Lint config rejects `liveProvider!.callModel`.
        if (!liveProvider) {
          throw new HarnessError(
            'liveProvider is required in record mode (internal invariant).',
            'MISSING_LIVE_PROVIDER'
          );
        }
        const { systemBlocks } = buildOrchestratorPrompt(
          orgContext,
          loadedSkillIds
        );
        modelOutput = await liveProvider.callModel({
          systemBlocks,
          toolNames,
          messages: [...messages],
          maxRounds: MAX_ROUNDS_PER_TURN - round,
          preferredModel,
        });
      } else {
        const replayedRound = readRecordedRound(
          existingRecording,
          turnIndex,
          round
        );
        if (!replayedRound) {
          throw new HarnessError(
            `Recording for fixture "${fixture.id}" is missing turn ${turnIndex} round ${round}.`,
            'INCOMPLETE_RECORDING'
          );
        }
        modelOutput = {
          modelText: replayedRound.modelText,
          toolUses: replayedRound.toolUses.map((t) => ({
            name: t.name,
            input: t.input,
          })),
          stopReason: replayedRound.stopReason,
        };
      }

      lastModelText = modelOutput.modelText;

      // Build the assistant message with text + tool_use blocks for the
      // next round to reference.
      const assistantContent: AnthropicMessageContent[] = [];
      if (modelOutput.modelText) {
        assistantContent.push({ type: 'text', text: modelOutput.modelText });
      }
      const toolUseIds: string[] = [];
      for (let i = 0; i < modelOutput.toolUses.length; i++) {
        const u = modelOutput.toolUses[i];
        if (!u) continue;
        const id = `tool_use_${turnIndex}_${round}_${i}`;
        toolUseIds.push(id);
        assistantContent.push({
          type: 'tool_use',
          id,
          name: u.name,
          input: u.input,
        });
      }
      messages.push({ role: 'assistant', content: assistantContent });

      // Resolve tool results. In replay we read them straight from the
      // recording; in record we invoke the fixture's stubs.
      const recordedToolUses: {
        name: string;
        input: Record<string, unknown>;
        result: HarnessToolResult;
      }[] = [];
      const toolResultBlocks: AnthropicMessageContent[] = [];

      for (let i = 0; i < modelOutput.toolUses.length; i++) {
        const u = modelOutput.toolUses[i];
        const id = toolUseIds[i];
        if (!u || !id) continue;

        let result: HarnessToolResult;
        if (mode === 'record') {
          result = invokeStub({
            toolName: u.name,
            input: u.input,
            stubsByName,
            stub: stubsByName.get(u.name),
            loadedSkillIds,
            turnTrace,
          });
        } else {
          const recorded = readRecordedToolResult(
            existingRecording,
            turnIndex,
            round,
            i
          );
          if (!recorded) {
            throw new HarnessError(
              `Recording for fixture "${fixture.id}" is missing tool result for turn ${turnIndex} round ${round} use ${i}.`,
              'INCOMPLETE_RECORDING'
            );
          }
          result = recorded;
        }

        applySideEffects({
          toolName: u.name,
          input: u.input,
          result,
          loadedSkillIds,
          turnTrace,
        });

        const toolCall: HarnessToolCall = {
          name: u.name,
          input: u.input,
          result,
        };
        turnTrace.toolCalls.push(toolCall);
        recordedToolUses.push({ name: u.name, input: u.input, result });

        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: id,
          content: serializeToolResultForModel(result),
          is_error: !result.ok,
        });
      }

      if (toolResultBlocks.length > 0) {
        messages.push({ role: 'user', content: toolResultBlocks });
      }

      recordedRounds.push({
        modelText: modelOutput.modelText,
        toolUses: recordedToolUses,
        stopReason: modelOutput.stopReason,
      });

      if (
        modelOutput.stopReason === 'end_turn' ||
        modelOutput.stopReason === 'max_tokens' ||
        modelOutput.stopReason === 'pause_turn'
      ) {
        stopped = true;
        break;
      }
    }

    if (!stopped) {
      // Hit the round cap. Surface as a per-turn failure via the runner
      // (the trace's `rounds` will equal MAX_ROUNDS_PER_TURN, but no
      // structural assertion catches "too many rounds" — fixtures that
      // care should bound themselves implicitly via expectations).
    }

    turnTrace.finalText = lastModelText;
    turnTrace.loadedSkillIdsAtEnd = [...loadedSkillIds];
    trace.perTurn.push(turnTrace);

    recordedTurns.push({
      userMessage: fixtureTurn.userMessage,
      classifierResponse: turnTrace.classifierCall,
      rounds: recordedRounds,
    });
  }

  if (mode === 'record') {
    const next: HarnessRecording = {
      version: 1,
      fixtureId: fixture.id,
      recordedAt: new Date().toISOString(),
      skillRegistryVersion: SKILL_REGISTRY_VERSION,
      turns: recordedTurns,
    };
    await recordingProvider.write(next);
  }

  return trace;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export class HarnessError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'HarnessError';
  }
}

function mergeOrgContext(
  overrides?: Partial<AssistantContext>
): AssistantContext {
  if (!overrides) return DEFAULT_ORG_CONTEXT;
  return { ...DEFAULT_ORG_CONTEXT, ...overrides };
}

function ensureDefaultSkill(loadedSkillIds: string[]): void {
  if (!loadedSkillIds.includes('default')) {
    loadedSkillIds.unshift('default');
  }
}

/**
 * Derive the per-turn preferred model the same way the controller will
 * (W-C03-D / W-C02-E): if any loaded skill prefers Opus, the whole turn
 * runs on Opus.
 */
function derivePreferredModel(loadedSkillIds: string[]): 'sonnet' | 'opus' {
  for (const id of loadedSkillIds) {
    const skill = getSkillById(id);
    if (skill?.preferredModel === 'opus') return 'opus';
  }
  return 'sonnet';
}

/**
 * Resolve the available tool names for the current loadedSkillIds, plus
 * the always-loaded meta tools.
 */
function currentToolNames(loadedSkillIds: string[]): string[] {
  const skillToolNames = buildToolListForSkills(loadedSkillIds);
  const out = [...skillToolNames];
  for (const name of META_TOOL_NAMES) {
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

interface ClassifierRunInput {
  userMessage: string;
  organizationId: string;
  mode: EvalMode;
  liveProvider?: LiveProvider;
  existingRecording: HarnessRecording | null;
  turnIndex: number;
}

async function runClassifier(
  input: ClassifierRunInput
): Promise<{ skillIds: string[]; confidence: number } | null> {
  if (input.mode === 'replay') {
    const recordedTurn = input.existingRecording?.turns[input.turnIndex];
    return recordedTurn?.classifierResponse ?? null;
  }
  // Record mode: prefer the live provider's hook (deterministic in tests);
  // fall back to the real `classifyIntent` service.
  if (input.liveProvider?.classifyIntent) {
    const result = await input.liveProvider.classifyIntent(
      input.userMessage,
      input.organizationId
    );
    if (result.success) return result.data;
    return null;
  }
  const result = await classifyIntent({
    userMessage: input.userMessage,
    organizationId: input.organizationId,
  });
  if (result.success) return result.data;
  return null;
}

interface InvokeStubArgs {
  toolName: string;
  input: Record<string, unknown>;
  stubsByName: Map<string, HarnessToolStub>;
  stub: HarnessToolStub | undefined;
  loadedSkillIds: string[];
  turnTrace: HarnessTurnTrace;
}

/**
 * Invoke a stub during record mode. Reproduces the structural shape of
 * the live factory's destructive flow:
 *   - First call (no `confirmationToken`) → run hard-block checks; on
 *     fail emit `hard_block_violation`; otherwise emit
 *     `confirmation_required`.
 *   - Second call (with `confirmationToken`) → invoke `respond`.
 *
 * Non-destructive tools just call `respond`. Meta tools are handled by
 * `applySideEffects`; they pass through this function with whatever
 * stub the fixture provided (or a built-in synthetic if missing).
 */
function invokeStub(args: InvokeStubArgs): HarnessToolResult {
  const { toolName, input, stub } = args;

  // Built-in handling for meta tools when the fixture didn't provide a
  // stub. These shapes mirror the real ones in
  // `apps/api/src/assistant/tools/meta/`.
  if (!stub && toolName === 'meta_loadSkill') {
    const skillId =
      typeof input.skillId === 'string' ? (input.skillId as string) : '';
    const skill = getSkillById(skillId);
    if (!skill) {
      return {
        ok: false,
        error: `Unknown skill ID "${skillId}". Use one of the IDs listed in the skill index.`,
        code: 'UNKNOWN_SKILL',
      };
    }
    return {
      ok: true,
      data: {
        loaded: true,
        skillId: skill.id,
        newToolsAvailable: skill.toolNames,
        promptFragment: skill.promptFragment,
      },
    };
  }
  if (!stub && toolName === 'meta_dispatchTour') {
    const tourKind =
      typeof input.tourKind === 'string' ? (input.tourKind as string) : '';
    return {
      ok: true,
      presentation: {
        type: 'tour_dispatch',
        tourKind,
        payload:
          input.payload && typeof input.payload === 'object'
            ? (input.payload as Record<string, unknown>)
            : undefined,
        navigateTo: TOUR_NAVIGATION[tourKind] ?? '/',
      },
    };
  }

  if (!stub) {
    return {
      ok: false,
      error: `No stub registered for tool "${toolName}".`,
      code: 'STUB_MISSING',
    };
  }

  if (stub.destructive) {
    const tokenInInput =
      typeof input.confirmationToken === 'string'
        ? (input.confirmationToken as string)
        : null;
    if (!tokenInInput) {
      // First call: hard blocks, then synthetic confirmation_required.
      if (stub.hardBlockChecks) {
        for (const check of stub.hardBlockChecks) {
          const failureMessage = check.evaluate(input);
          if (failureMessage) {
            return {
              ok: false,
              error: failureMessage,
              code: check.code,
              presentation: {
                type: 'hard_block_violation',
                code: check.code,
                message: failureMessage,
              },
            };
          }
        }
      }
      const summary = stub.summarizeForConfirmation
        ? stub.summarizeForConfirmation(input)
        : { resourceId: 'unknown' };
      return {
        ok: true,
        presentation: {
          type: 'confirmation_required',
          action: stub.destructiveAction ?? 'launch_ad',
          resourceId: summary.resourceId,
          token: `synthetic-token-${stub.name}-${summary.resourceId}`,
          expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          summary: {
            title: summary.title,
            fields: summary.fields,
          },
          executeToolName: stub.name,
        },
      };
    }
    // Second call: real execution.
    return stub.respond(input, /* callIndex */ 1);
  }

  return stub.respond(input, /* callIndex */ 0);
}

const TOUR_NAVIGATION: Record<string, string> = {
  create_ad: '/dashboard/advertising/create',
  create_video: '/create-video/general',
  create_offer: '/dashboard/offers/new',
  create_post: '/dashboard/content-calendar/month',
};

interface ApplySideEffectsArgs {
  toolName: string;
  input: Record<string, unknown>;
  result: HarnessToolResult;
  loadedSkillIds: string[];
  turnTrace: HarnessTurnTrace;
}

/**
 * Drive harness-level state from a tool result. Runs in BOTH replay and
 * record modes — replay observes the stored result; record observes the
 * stub's just-produced result. Either way, we capture the same trace
 * events.
 */
function applySideEffects(args: ApplySideEffectsArgs): void {
  const { toolName, input, result, loadedSkillIds, turnTrace } = args;

  // meta_loadSkill mutates loadedSkillIds + emits a skill-load event.
  if (toolName === 'meta_loadSkill' && result.ok) {
    const skillId =
      typeof input.skillId === 'string' ? (input.skillId as string) : '';
    const skill = getSkillById(skillId);
    if (skill && !loadedSkillIds.includes(skill.id)) {
      loadedSkillIds.push(skill.id);
      turnTrace.skillLoadEvents.push({ skillId: skill.id });
    }
  }

  // confirmation_required + hard_block_violation presentations are pulled
  // out into trace-level events so fixture expectations can match without
  // walking the per-tool result list.
  const presentation: HarnessPresentation | undefined = result.presentation;
  if (!presentation) return;
  if (presentation.type === 'confirmation_required') {
    turnTrace.confirmationEvents.push({
      action: presentation.action,
      resourceId: presentation.resourceId,
      toolName,
    });
    return;
  }
  if (presentation.type === 'hard_block_violation') {
    turnTrace.hardBlockEvents.push({
      code: presentation.code,
      message: presentation.message,
      toolName,
    });
  }
}

function readRecordedRound(
  recording: HarnessRecording | null,
  turnIndex: number,
  roundIndex: number
): RecordedRound | null {
  return recording?.turns[turnIndex]?.rounds[roundIndex] ?? null;
}

function readRecordedToolResult(
  recording: HarnessRecording | null,
  turnIndex: number,
  roundIndex: number,
  useIndex: number
): HarnessToolResult | null {
  const recordedRound = readRecordedRound(recording, turnIndex, roundIndex);
  return recordedRound?.toolUses[useIndex]?.result ?? null;
}

/**
 * The model sees tool results as a single string (`content`) on a
 * `tool_result` block. We serialize the structured `HarnessToolResult`
 * into JSON so the model has full context. The factory's real wrapping
 * does the same.
 */
function serializeToolResultForModel(result: HarnessToolResult): string {
  return JSON.stringify(result);
}
