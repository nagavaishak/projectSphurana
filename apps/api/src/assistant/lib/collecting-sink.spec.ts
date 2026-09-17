import type { Anthropic } from '@borradh-workspace/ai';
import type {
  AssistantToolsContext,
  ToolDefinition,
} from '../tool-factory/index.js';
import {
  CollectingSink,
  assembleHeadlessTurnResult,
} from './collecting-sink.js';
import type { UIStreamEvent } from './emit-ui-stream-event.js';
import { runClaireTurn } from './run-claire-turn.js';
import { SseSink } from './sse-sink.js';

/**
 * WS-2 parity gate.
 *
 * Runs the SAME scripted Anthropic sequence (the WS-1 fixtures) through BOTH
 * `SseSink` and `CollectingSink`, then asserts the CollectingSink captured the
 * exact text + tool input/output data the SseSink carried on its frames — i.e.
 * no information is lost on the headless/WhatsApp path vs the web path. Also
 * asserts `toolParts` (returned by `runClaireTurn`) is identical regardless of
 * sink.
 */

// Deterministic UUIDs so text/reasoning stream ids are stable (mirrors WS-1).
let uuidCounter = 0;
jest.mock('node:crypto', () => ({
  randomUUID: () => `uuid-${++uuidCounter}`,
}));

function makeFakeStream(
  events: unknown[],
  stopReason: Anthropic.StopReason
): {
  [Symbol.asyncIterator](): AsyncIterator<unknown>;
  finalMessage(): Promise<{ stop_reason: Anthropic.StopReason }>;
} {
  return {
    async *[Symbol.asyncIterator]() {
      for (const e of events) yield e;
    },
    async finalMessage() {
      return { stop_reason: stopReason };
    },
  };
}

function makeFakeClient(
  rounds: Array<{ events: unknown[]; stopReason: Anthropic.StopReason }>
): Anthropic {
  let call = 0;
  return {
    messages: {
      stream: () => {
        const r = rounds[call++];
        return makeFakeStream(r.events, r.stopReason);
      },
    },
  } as unknown as Anthropic;
}

const noopLogger = { error: () => {}, log: () => {} };

/** Round 1: text "Hi! " + echo tool_use → tool_use. Round 2: "Done." → end_turn. */
function scriptedRounds() {
  return [
    {
      events: [
        { type: 'message_start' },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Hi! ' },
        },
        { type: 'content_block_stop', index: 0 },
        {
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'tool_use', id: 'tool-1', name: 'echo' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '{"msg":' },
        },
        {
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'input_json_delta', partial_json: '"hey"}' },
        },
        { type: 'content_block_stop', index: 1 },
        { type: 'message_delta', delta: { stop_reason: 'tool_use' } },
        { type: 'message_stop' },
      ],
      stopReason: 'tool_use' as Anthropic.StopReason,
    },
    {
      events: [
        { type: 'message_start' },
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        },
        {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Done.' },
        },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ],
      stopReason: 'end_turn' as Anthropic.StopReason,
    },
  ];
}

function echoToolMap(): Map<string, ToolDefinition> {
  const echo = {
    name: 'echo',
    toAnthropicDefinition: () => ({
      name: 'echo',
      description: 'echoes',
      input_schema: { type: 'object', properties: {} },
    }),
    execute: async (input: unknown) => ({
      ok: true as const,
      data: { echoed: input },
      presentation: { type: 'preview_card', label: 'Echo' },
    }),
  } as unknown as ToolDefinition;
  return new Map([['echo', echo]]);
}

const baseParams = () => ({
  model: 'claude-sonnet-4-6' as const,
  system: [] as Anthropic.TextBlockParam[],
  initialMessages: [
    { role: 'user' as const, content: 'hi' },
  ] as Anthropic.MessageParam[],
  toolCtx: {} as AssistantToolsContext,
  maxTokens: 4096,
  logger: noopLogger,
});

describe('CollectingSink — WS-2 parity with SseSink', () => {
  beforeEach(() => {
    uuidCounter = 0;
  });

  it('captures the same text + tool data the SseSink carries on its frames', async () => {
    // ── Web path: SseSink ──
    uuidCounter = 0;
    const frames: UIStreamEvent[] = [];
    const sseResult = await runClaireTurn({
      ...baseParams(),
      client: makeFakeClient(scriptedRounds()),
      toolMap: echoToolMap(),
      sink: new SseSink((e) => frames.push(e)),
    });

    // ── Headless path: CollectingSink ──
    uuidCounter = 0;
    const sink = new CollectingSink();
    const collectingResult = await runClaireTurn({
      ...baseParams(),
      client: makeFakeClient(scriptedRounds()),
      toolMap: echoToolMap(),
      sink,
    });
    const headless = assembleHeadlessTurnResult(
      sink.collected,
      collectingResult
    );

    // ── Derive the data the SseSink frames carried ──
    const sseText = frames
      .filter((f) => f.type === 'text-delta')
      .map((f) => (f as Extract<UIStreamEvent, { type: 'text-delta' }>).delta);
    const sseToolInputs = frames
      .filter((f) => f.type === 'tool-input-available')
      .map((f) => {
        const e = f as Extract<UIStreamEvent, { type: 'tool-input-available' }>;
        return { toolName: e.toolName, input: e.input };
      });
    const sseToolOutputs = frames
      .filter((f) => f.type === 'tool-output-available')
      .map(
        (f) =>
          (f as Extract<UIStreamEvent, { type: 'tool-output-available' }>)
            .output
      );

    const echoOutput = {
      echoed: { msg: 'hey' },
      presentation: { type: 'preview_card', label: 'Echo' },
    };

    // Text: the two SseSink text-delta blocks concatenate into the two
    // CollectingSink segments.
    expect(sseText).toEqual(['Hi! ', 'Done.']);
    expect(headless.textSegments).toEqual(['Hi! ', 'Done.']);

    // Tool input: identical to what the SseSink frame carried.
    expect(sseToolInputs).toEqual([
      { toolName: 'echo', input: { msg: 'hey' } },
    ]);
    expect(headless.toolEvents).toEqual([
      {
        toolName: 'echo',
        toolCallId: 'tool-1',
        input: { msg: 'hey' },
        output: echoOutput,
        presentation: { type: 'preview_card', label: 'Echo' },
      },
    ]);

    // Tool output: the CollectingSink's `output` equals the SseSink frame
    // output, and `presentation` was correctly pulled out of it.
    expect(sseToolOutputs).toEqual([echoOutput]);
    expect(headless.toolEvents[0].output).toEqual(echoOutput);
    expect(headless.toolEvents[0].presentation).toEqual(
      echoOutput.presentation
    );

    // No information lost vs the web path: same final text.
    expect(headless.finalText).toBe('Done.');
    expect(headless.reasoningSegments).toEqual([]);

    // toolParts from runClaireTurn is identical regardless of sink.
    expect(collectingResult.toolParts).toEqual(sseResult.toolParts);
    expect(headless.toolParts).toEqual([
      {
        toolCallId: 'tool-1',
        toolName: 'echo',
        input: { msg: 'hey' },
        output: echoOutput,
      },
    ]);
    expect(headless.stopReason).toBe('end_turn');
    expect(headless.rounds).toBe(2);
    expect(collectingResult.stopReason).toBe(sseResult.stopReason);
    expect(collectingResult.rounds).toBe(sseResult.rounds);
  });
});
