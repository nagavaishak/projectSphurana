/**
 * Live-controller pipeline adapter for the Claire eval harness.
 *
 * Drives a fixture turn through the same plumbing the rebuilt
 * `assistant-chat.controller.ts` uses (`runToolLoop` + `emitUIStreamEvent` +
 * the manual-tool-loop SSE protocol), then parses the captured SSE bytes
 * back into a `HarnessTrace` so fixture `expect` blocks compare the same
 * way they do in `in-process` mode.
 *
 * **Why this lives in `apps/api`** — the in-process harness in
 * `packages/features/src/assistant/eval/harness.ts` cannot import from
 * `apps/api` (TypeScript project-reference direction). The brief originally
 * placed the controller adapter inside features; W-C04-A-finish moved it to
 * apps/api as a layering correction (documented in claire.md §7).
 *
 * **What this validates:**
 *  - `runToolLoop` round-trip through the Anthropic streaming SDK
 *  - `emitUIStreamEvent` chunk shapes (AI SDK UI message stream protocol)
 *  - `writeUIStreamHeaders` / `closeUIStream` framing
 *  - Tool dispatch pipeline (tool-use → tool-result feed-back loop)
 *
 * **What this does NOT validate** (and should not — the value-add over
 * in-process is HTTP/SSE/streaming specifically; the controller's outer
 * wrapping is exercised by the existing Playwright e2e suite + the
 * factory's 36-test unit suite):
 *  - `AuthGuard`, plan/quota gates, conversation persistence
 *  - DB-backed confirmation tokens (we use in-process fakes for fixture
 *    stub destructive flows)
 *  - Real classifier / knowledge / orchestrator (we use the in-process
 *    pieces via `@borradh-workspace/features/assistant`)
 *
 * **API key requirement** — this adapter calls Anthropic for real (no
 * recording-replay path in v1). Set `ANTHROPIC_API_KEY` to run. CI's
 * second eval job is gated on the secret and skipped when unavailable.
 *
 * @see ../lib/manual-tool-loop.ts
 * @see ../lib/emit-ui-stream-event.ts
 * @see packages/features/src/assistant/eval/harness.ts
 * @see docs/implementations/claire-briefs/window-c04-a-finish.md
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type Anthropic, createAnthropicClient } from '@borradh-workspace/ai';
import {
  type ClaireFixture,
  type EvalMode,
  type HarnessPresentation,
  type HarnessToolCall,
  type HarnessToolResult,
  type HarnessToolStub,
  type HarnessTrace,
  type HarnessTurnTrace,
  buildOrchestratorPrompt,
  buildToolListForSkills,
  classifyIntent,
  getSkillById,
} from '@borradh-workspace/features/assistant';
import type { Response } from 'express';
import { z } from 'zod';
import {
  type UIStreamEvent,
  closeUIStream,
  emitUIStreamEvent,
  writeUIStreamHeaders,
} from '../lib/emit-ui-stream-event.js';
import { runToolLoop } from '../lib/manual-tool-loop.js';
import { buildAssistantPorts } from '../ports/index.js';
import type {
  AssistantToolsContext,
  ConfirmationSummary,
  ToolDefinition,
  ToolResult,
} from '../tool-factory/index.js';
import { contextTools } from '../tools/context/index.js';
import { metaTools } from '../tools/meta/index.js';

const SYNTHETIC_ORG_ID = 'eval-org';
const SYNTHETIC_USER_ID = 'eval-user';
const SYNTHETIC_CONVERSATION_ID = 'eval-conversation';

const META_TOOL_NAMES: readonly string[] = [
  'meta_loadSkill',
  'meta_dispatchTour',
];

/**
 * Default org context the adapter feeds the orchestrator. Mirrors
 * `DEFAULT_ORG_CONTEXT` in the in-process harness so trace events compare
 * cleanly between modes.
 */
const DEFAULT_ORG_CONTEXT = {
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

export interface RunFixtureViaControllerOptions {
  fixture: ClaireFixture;
  toolStubs: HarnessToolStub[];
  /** Mode is `'record'` only for v1 — replay-mode-for-live-controller is a
   *  follow-up; SSE byte streams aren't yet captured to disk. The harness's
   *  CLI maps to 'record' when `EVAL_MODE=live-controller` is set. */
  mode: EvalMode;
}

/**
 * Run a fixture through the live controller pipeline. Returns the same
 * `HarnessTrace` shape `runFixture` (in-process) emits.
 */
export async function runFixtureViaController(
  options: RunFixtureViaControllerOptions
): Promise<HarnessTrace> {
  if (options.mode !== 'record') {
    throw new Error(
      `Live-controller mode only supports 'record' in v1 (got '${options.mode}'). Replay-mode-for-live-controller is deferred.`
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Live-controller mode requires ANTHROPIC_API_KEY. Use in-process mode for keyless replay.'
    );
  }

  const { fixture, toolStubs } = options;
  const stubsByName = new Map(toolStubs.map((s) => [s.name, s]));
  const trace: HarnessTrace = { fixtureId: fixture.id, perTurn: [] };

  const loadedSkillIds: string[] = [
    ...(fixture.setup?.initialLoadedSkillIds ?? []),
  ];
  if (loadedSkillIds.length === 0) loadedSkillIds.push('default');
  if (!loadedSkillIds.includes('default')) loadedSkillIds.unshift('default');

  // Anthropic message history persists across turns — same as the controller.
  const messages: Anthropic.MessageParam[] = [];

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

    // First-turn classifier (only when the fixture didn't pre-load skills).
    if (turnIndex === 0 && !fixture.setup?.initialLoadedSkillIds) {
      const classified = await classifyIntent({
        userMessage: fixtureTurn.userMessage,
        organizationId: SYNTHETIC_ORG_ID,
      });
      if (classified.success) {
        turnTrace.classifierCall = classified.data;
        for (const id of classified.data.skillIds) {
          if (!loadedSkillIds.includes(id)) loadedSkillIds.push(id);
        }
      }
    }

    messages.push({
      role: 'user',
      content: fixtureTurn.userMessage,
    });

    const { systemBlocks } = buildOrchestratorPrompt(
      DEFAULT_ORG_CONTEXT,
      loadedSkillIds
    );

    const toolMap = buildToolMap({
      loadedSkillIds,
      stubsByName,
      turnTrace,
      onSkillLoaded: (skillId) => {
        if (!loadedSkillIds.includes(skillId)) {
          loadedSkillIds.push(skillId);
          turnTrace.skillLoadEvents.push({ skillId });
        }
      },
    });

    const fakeRes = new FakeResponse();
    const events: UIStreamEvent[] = [];
    const captureEvent = (event: UIStreamEvent) => {
      events.push(event);
      emitUIStreamEvent(fakeRes as unknown as Response, event);
    };

    writeUIStreamHeaders(fakeRes as unknown as Response);
    captureEvent({ type: 'start', messageId: randomUUID() });

    const client = createAnthropicClient(process.env.ANTHROPIC_API_KEY);
    const preferredModel = derivePreferredModel(loadedSkillIds);
    const model =
      preferredModel === 'opus' ? 'claude-opus-4-7' : 'claude-sonnet-4-6';

    const toolCtx = buildEvalToolContext();

    let stopReason: Anthropic.StopReason | null = null;
    let finalText = '';
    try {
      const result = await runToolLoop({
        client,
        model,
        system: systemBlocks,
        initialMessages: messages,
        toolMap,
        toolCtx,
        maxTokens: 4096,
        emit: captureEvent,
        logger: {
          error: (...args) => console.error('[eval]', ...args),
          log: () => undefined,
        },
      });
      finalText = result.finalText;
      stopReason = result.stopReason;
      if (result.streamError) {
        captureEvent({
          type: 'error',
          errorText: `Stream error (${result.streamError.category}): ${result.streamError.message}`,
        });
        captureEvent({ type: 'finish', finishReason: 'error' });
      } else {
        captureEvent({
          type: 'finish',
          finishReason:
            result.stopReason === 'tool_use'
              ? 'tool-calls'
              : result.stopReason === 'end_turn' ||
                  result.stopReason === 'stop_sequence'
                ? 'stop'
                : result.stopReason === 'max_tokens'
                  ? 'length'
                  : 'stop',
        });
      }
    } catch (error) {
      const errorText =
        error instanceof Error ? error.message : 'Unknown error';
      captureEvent({ type: 'error', errorText });
      captureEvent({ type: 'finish', finishReason: 'error' });
    }

    closeUIStream(fakeRes as unknown as Response);

    // Parse the captured SSE bytes back into events to validate the encoding
    // round-trip. The events array we built directly is the source of truth
    // for trace fields; the parsed-from-bytes array is asserted to equal it
    // (see assertSseRoundTrip below). Any mismatch is a controller bug —
    // either emit-ui-stream-event or our parser drifted from the spec.
    const parsedFromBytes = parseSseStream(fakeRes.captured());
    assertSseRoundTrip(events, parsedFromBytes, fixture.id);

    // Translate UIStreamEvents into HarnessTurnTrace shape.
    populateTurnTraceFromEvents({
      events,
      turnTrace,
      stubsByName,
      finalText,
    });
    turnTrace.loadedSkillIdsAtEnd = [...loadedSkillIds];
    void stopReason;
    trace.perTurn.push(turnTrace);

    // Drop the user message for the next turn's history. `runToolLoop`
    // itself appends assistant + tool_result blocks during its execution
    // (the `messages` array is mutated by reference). For the eval we keep
    // it simple: rely on the model to recover from a fresh turn boundary.
  }

  return trace;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface BuildToolMapInput {
  loadedSkillIds: string[];
  stubsByName: Map<string, HarnessToolStub>;
  turnTrace: HarnessTurnTrace;
  onSkillLoaded: (skillId: string) => void;
}

/**
 * Build the dispatch map the live controller would build for this turn,
 * but with fixture-stub-backed `execute` functions in place of real tool
 * implementations.
 *
 * Tool resolution order:
 *   1. Fixture stub (when one exists for the tool name) — wraps the stub's
 *      `respond` in a minimal `ToolDefinition` shape; reproduces the
 *      destructive two-call flow inline.
 *   2. Real `metaTools` (`meta_loadSkill`, `meta_dispatchTour`) — always
 *      loaded.
 *   3. Real `contextTools` — always loaded.
 *
 * The ad/video/content legacy shimmed tools aren't included; fixtures that
 * exercise them currently rely on stubs.
 */
function buildToolMap(input: BuildToolMapInput): Map<string, ToolDefinition> {
  const { loadedSkillIds, stubsByName, turnTrace, onSkillLoaded } = input;
  const map = new Map<string, ToolDefinition>();

  // Skill-driven tool list, augmented with always-loaded meta tools.
  const skillToolNames = buildToolListForSkills(loadedSkillIds);
  const wantedNames = new Set<string>([...skillToolNames, ...META_TOOL_NAMES]);

  // 1. Fixture stubs (override any real tool of the same name).
  for (const [name, stub] of stubsByName.entries()) {
    map.set(name, fixtureStubToToolDefinition(stub, turnTrace, onSkillLoaded));
    wantedNames.add(name);
  }

  // 2 + 3. Always-loaded meta + context tools, unless a stub already claimed
  // the slot.
  for (const tool of [...metaTools, ...contextTools]) {
    if (!map.has(tool.name) && wantedNames.has(tool.name)) {
      map.set(tool.name, tool);
    }
  }

  return map;
}

/**
 * Wrap a `HarnessToolStub` in a `ToolDefinition`-shaped object. The
 * destructive two-call flow is reproduced here (synthetic
 * `confirmation_required` on first call without a token; `respond` on the
 * second call with one) so trace events match the in-process harness.
 */
function fixtureStubToToolDefinition(
  stub: HarnessToolStub,
  turnTrace: HarnessTurnTrace,
  onSkillLoaded: (skillId: string) => void
): ToolDefinition {
  const inputSchema = z.object({}).passthrough();
  const description = `[eval stub] ${stub.name}`;

  return {
    name: stub.name,
    feature: 'eval-stub',
    action: stub.name,
    description,
    inputSchema,
    destructive: !!stub.destructive,
    preferredModel: 'sonnet',
    hardBlocks: [],
    toAnthropicDefinition: () => ({
      name: stub.name,
      description,
      input_schema: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
    }),
    execute: async (input) => {
      const args =
        input && typeof input === 'object' && !Array.isArray(input)
          ? (input as Record<string, unknown>)
          : {};

      // Meta-tool side effect: when a fixture stubs `meta_loadSkill`, mirror
      // the real meta tool's loadedSkillIds mutation. Most fixtures rely on
      // the real `metaTools` instead — this branch is here in case a fixture
      // overrides.
      if (stub.name === 'meta_loadSkill') {
        const skillId = typeof args.skillId === 'string' ? args.skillId : '';
        if (skillId) onSkillLoaded(skillId);
      }

      if (stub.destructive) {
        const tokenInInput =
          typeof args.confirmationToken === 'string'
            ? args.confirmationToken
            : null;
        if (!tokenInInput) {
          // First call — hard blocks then synthetic confirmation_required.
          if (stub.hardBlockChecks) {
            for (const check of stub.hardBlockChecks) {
              const failureMessage = check.evaluate(args);
              if (failureMessage) {
                turnTrace.hardBlockEvents.push({
                  code: check.code,
                  message: failureMessage,
                  toolName: stub.name,
                });
                return {
                  ok: false,
                  error: failureMessage,
                  code: check.code,
                  presentation: {
                    type: 'hard_block_violation',
                    code: check.code,
                    message: failureMessage,
                  },
                } satisfies ToolResult;
              }
            }
          }
          const summary: ConfirmationSummary = stub.summarizeForConfirmation
            ? stub.summarizeForConfirmation(args)
            : { resourceId: 'unknown' };
          // Fixtures use arbitrary action labels; the factory's
          // PresentationPayload typing wants `ClaireConfirmationAction`. The
          // adapter sidesteps the DB enum coupling by widening through string.
          const action: string = stub.destructiveAction ?? 'launch_ad';
          turnTrace.confirmationEvents.push({
            action,
            resourceId: summary.resourceId,
            toolName: stub.name,
          });
          return {
            ok: true,
            presentation: {
              // The factory's PresentationPayload uses ClaireConfirmationAction;
              // we cast through string to keep the eval adapter independent of
              // the DB enum (fixtures use arbitrary action labels).
              type: 'confirmation_required',
              action: action as never,
              resourceId: summary.resourceId,
              token: `synthetic-token-${stub.name}-${summary.resourceId}`,
              expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
              summary: { title: summary.title, fields: summary.fields },
              executeToolName: stub.name,
            },
          } satisfies ToolResult;
        }
      }

      const stubResult: HarnessToolResult = stub.respond(
        args,
        /* callIndex */ stub.destructive ? 1 : 0
      );
      return harnessResultToToolResult(stubResult);
    },
  };
}

function harnessResultToToolResult(
  result: HarnessToolResult
): ToolResult<unknown> {
  if (result.ok) {
    return {
      ok: true,
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.presentation
        ? { presentation: result.presentation as never }
        : {}),
    };
  }
  return {
    ok: false,
    error: result.error,
    ...(result.code ? { code: result.code } : {}),
    ...(result.presentation
      ? { presentation: result.presentation as never }
      : {}),
  };
}

function derivePreferredModel(loadedSkillIds: string[]): 'sonnet' | 'opus' {
  for (const id of loadedSkillIds) {
    const skill = getSkillById(id);
    if (skill?.preferredModel === 'opus') return 'opus';
  }
  return 'sonnet';
}

/**
 * Minimal in-eval stand-in for the production `AssistantToolsContext`. The
 * factory exposes `apiFetch` + `runHardBlocks` + `createConfirmation` /
 * `verifyConfirmation` — none of which the fixture stubs exercise (they
 * short-circuit the factory by registering as their own ToolDefinitions).
 *
 * The real `metaTools` and `contextTools` DO touch this context's
 * `apiFetch` though — fixtures that load those skills should provide stubs
 * (existing fixtures already do). The stubs throw if a real tool reaches
 * for `apiFetch`; that's a fixture-incompleteness signal and not a bug.
 */
function buildEvalToolContext(): AssistantToolsContext {
  const stubFetch = async () => {
    throw new Error(
      'Live-controller eval: a real tool reached for apiFetch. Add a fixture stub for the tool name to override.'
    );
  };
  return {
    organizationId: SYNTHETIC_ORG_ID,
    timezone: 'Europe/Dublin',
    userId: SYNTHETIC_USER_ID,
    conversationId: SYNTHETIC_CONVERSATION_ID,
    apiFetch: stubFetch as unknown as AssistantToolsContext['apiFetch'],
    buildApiFetch: () =>
      stubFetch as unknown as AssistantToolsContext['apiFetch'],
    // Ports are built over the same stubbed fetch, so a ported tool reaching
    // for a capability the fixture did not stub fails loudly, exactly as an
    // unstubbed `apiFetch` call does today.
    ports: buildAssistantPorts({
      apiFetch: stubFetch as unknown as AssistantToolsContext['apiFetch'],
      organizationId: SYNTHETIC_ORG_ID,
      conversationId: SYNTHETIC_CONVERSATION_ID,
    }),
    // No-op for eval: the factory injects a real tool-bound reporter per call.
    reportIssue: () => {},
    callCounter: { count: 0, max: 50 },
    runHardBlocks: async () => ({ pass: true }),
    createConfirmation: async () => ({
      id: 'eval-token',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    }),
    verifyConfirmation: async () => ({ valid: true, payload: null }),
  };
}

// ---------------------------------------------------------------------------
// SSE round-trip parsing + assertion
// ---------------------------------------------------------------------------

/**
 * Parse an AI SDK UI message stream byte buffer back into events.
 *
 * Format: `data: <json>\n\n` per event, plus a `data: [DONE]\n\n` terminator.
 * Same format the frontend `useChat({ transport: DefaultChatTransport })`
 * consumes — keeping the parser here lets us catch encoder/parser drift in
 * the same test pass.
 */
export function parseSseStream(buffer: string): UIStreamEvent[] {
  const events: UIStreamEvent[] = [];
  // Split by blank-line boundary (`\n\n`); each frame is one `data: <…>` line.
  const frames = buffer.split('\n\n').filter((f) => f.trim().length > 0);
  for (const frame of frames) {
    const line = frame.trim();
    if (!line.startsWith('data: ')) continue;
    const payload = line.slice('data: '.length);
    if (payload === '[DONE]') continue;
    try {
      events.push(JSON.parse(payload) as UIStreamEvent);
    } catch {
      // Malformed frame is itself a regression — surface via assertion.
      throw new Error(
        `parseSseStream: failed to parse SSE frame: ${JSON.stringify(payload).slice(0, 200)}`
      );
    }
  }
  return events;
}

/**
 * Compare the events the controller emitted (`captureEvent`) against the
 * events parsed from the SSE byte buffer. Any mismatch is an encoder/parser
 * bug.
 */
function assertSseRoundTrip(
  emitted: UIStreamEvent[],
  parsed: UIStreamEvent[],
  fixtureId: string
): void {
  if (emitted.length !== parsed.length) {
    throw new Error(
      `[${fixtureId}] SSE round-trip mismatch: emitted=${emitted.length} events, parsed=${parsed.length}`
    );
  }
  for (let i = 0; i < emitted.length; i++) {
    const a = JSON.stringify(emitted[i]);
    const b = JSON.stringify(parsed[i]);
    if (a !== b) {
      throw new Error(
        `[${fixtureId}] SSE round-trip mismatch at event #${i}:\n  emitted: ${a}\n  parsed:  ${b}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// UI events → HarnessTurnTrace
// ---------------------------------------------------------------------------

interface PopulateTurnTraceInput {
  events: UIStreamEvent[];
  turnTrace: HarnessTurnTrace;
  stubsByName: Map<string, HarnessToolStub>;
  finalText: string;
}

function populateTurnTraceFromEvents(input: PopulateTurnTraceInput): void {
  const { events, turnTrace, finalText } = input;

  // Map toolCallId → (name, input) so we can join `tool-output-available`
  // back to the call. Some events' `toolName` is set on input-start, others
  // on input-available — we accept whichever lands first.
  const toolCallByCallId = new Map<
    string,
    { name: string; input: Record<string, unknown> }
  >();
  let rounds = 0;

  for (const event of events) {
    switch (event.type) {
      case 'start-step':
        rounds += 1;
        break;
      case 'tool-input-start': {
        toolCallByCallId.set(event.toolCallId, {
          name: event.toolName,
          input: {},
        });
        break;
      }
      case 'tool-input-available': {
        const existing = toolCallByCallId.get(event.toolCallId) ?? {
          name: event.toolName,
          input: {},
        };
        existing.input =
          event.input && typeof event.input === 'object'
            ? (event.input as Record<string, unknown>)
            : {};
        existing.name = event.toolName;
        toolCallByCallId.set(event.toolCallId, existing);
        break;
      }
      case 'tool-output-available': {
        const call = toolCallByCallId.get(event.toolCallId);
        if (!call) break;
        const result = normaliseToolOutput(event.output);
        const toolCall: HarnessToolCall = {
          name: call.name,
          input: call.input,
          result,
        };
        turnTrace.toolCalls.push(toolCall);

        const presentation = result.ok
          ? result.presentation
          : result.presentation;
        applyPresentationToTurnTrace(presentation, call.name, turnTrace);
        break;
      }
      case 'tool-output-error': {
        const call = toolCallByCallId.get(event.toolCallId);
        if (!call) break;
        turnTrace.toolCalls.push({
          name: call.name,
          input: call.input,
          result: { ok: false, error: event.errorText },
        });
        break;
      }
      default:
        break;
    }
  }

  turnTrace.rounds = Math.max(1, rounds);
  turnTrace.finalText = finalText;
}

function normaliseToolOutput(output: unknown): HarnessToolResult {
  if (!output || typeof output !== 'object') {
    return { ok: true, data: output };
  }
  const obj = output as Record<string, unknown>;
  if (obj.ok === true) {
    return {
      ok: true,
      ...(obj.data !== undefined ? { data: obj.data } : {}),
      ...(obj.presentation
        ? { presentation: obj.presentation as HarnessPresentation }
        : {}),
    };
  }
  if (obj.ok === false) {
    return {
      ok: false,
      error: typeof obj.error === 'string' ? obj.error : 'unknown error',
      ...(typeof obj.code === 'string' ? { code: obj.code } : {}),
      ...(obj.presentation
        ? { presentation: obj.presentation as HarnessPresentation }
        : {}),
    };
  }
  // No `ok` discriminator — treat as opaque success payload.
  return { ok: true, data: output };
}

function applyPresentationToTurnTrace(
  presentation: HarnessPresentation | undefined,
  toolName: string,
  turnTrace: HarnessTurnTrace
): void {
  if (!presentation) return;
  if (presentation.type === 'confirmation_required') {
    // De-duplicate against the synthetic event we already pushed when the
    // fixture stub ran in its destructive first call. Tools wrapped via
    // the real factory will land here.
    const already = turnTrace.confirmationEvents.find(
      (c) =>
        c.action === presentation.action &&
        c.resourceId === presentation.resourceId
    );
    if (!already) {
      turnTrace.confirmationEvents.push({
        action: presentation.action,
        resourceId: presentation.resourceId,
        toolName,
      });
    }
    return;
  }
  if (presentation.type === 'hard_block_violation') {
    const already = turnTrace.hardBlockEvents.find(
      (h) => h.code === presentation.code
    );
    if (!already) {
      turnTrace.hardBlockEvents.push({
        code: presentation.code,
        message: presentation.message,
        toolName,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// FakeResponse — captures res.write into a string buffer
// ---------------------------------------------------------------------------

/**
 * Minimal Express-`Response`-shaped object the SSE writer accepts. Captures
 * every `res.write` payload so the SSE bytes can be parsed back. Methods
 * not exercised by the SSE writer (`json`, `send`, `redirect`, etc.) throw
 * to surface accidental misuse.
 */
class FakeResponse extends EventEmitter {
  writableEnded = false;
  destroyed = false;

  private chunks: string[] = [];

  writeHead(_status: number, _headers?: Record<string, string>): this {
    return this;
  }

  flushHeaders(): void {
    // Real Express response flushes immediately; fake one is a no-op.
  }

  setTimeout(_ms: number): this {
    return this;
  }

  write(chunk: string | Buffer): boolean {
    if (this.writableEnded) return false;
    this.chunks.push(
      typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    );
    return true;
  }

  end(chunk?: string | Buffer): this {
    if (chunk) this.write(chunk);
    this.writableEnded = true;
    return this;
  }

  captured(): string {
    return this.chunks.join('');
  }
}
