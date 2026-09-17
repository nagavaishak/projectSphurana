import type { Anthropic } from '@borradh-workspace/ai';
import type {
  AssistantToolsContext,
  ToolDefinition,
} from '../tool-factory/index.js';
import type { UIStreamEvent } from './emit-ui-stream-event.js';
import { runToolLoop } from './manual-tool-loop.js';
import { runClaireTurn } from './run-claire-turn.js';
import { SseSink } from './sse-sink.js';
import type { TurnSink } from './turn-sink.js';

/**
 * WS-1 parity gate.
 *
 * Drives `runClaireTurn` over a fixed, scripted sequence of Anthropic stream
 * events (a text block + a tool_use with input_json_delta, then a second
 * round with the tool_result feeding an end_turn). We capture the
 * `UIStreamEvent`s the `SseSink` produces and assert they deep-equal the
 * array the legacy inline `emit` path would have produced for the same script.
 *
 * Deep-equal of the captured SSE event arrays is THE acceptance gate: it
 * proves the web wire output is byte-identical pre/post the TurnSink
 * extraction.
 */

// Deterministic UUIDs so text/reasoning stream ids are stable in assertions.
let uuidCounter = 0;
jest.mock('node:crypto', () => ({
  randomUUID: () => `uuid-${++uuidCounter}`,
}));

/** A scripted Anthropic stream: async-iterable of raw events + finalMessage(). */
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

/** Fake Anthropic client whose `messages.stream` returns scripted rounds. */
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

const noopLogger = {
  error: () => {},
  log: () => {},
};

/**
 * Round 1: a text block ("Hi! ") + a tool_use (`echo`) with streamed JSON
 * input. stop_reason = tool_use → loop feeds the tool_result back.
 * Round 2: a closing text block ("Done."). stop_reason = end_turn.
 */
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

/** Single `echo` tool that returns its input + a presentation envelope. */
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

describe('runClaireTurn — WS-1 SSE parity', () => {
  beforeEach(() => {
    uuidCounter = 0;
  });

  it('SseSink emits the exact legacy UIStreamEvent sequence', async () => {
    const captured: UIStreamEvent[] = [];
    const client = makeFakeClient(scriptedRounds());

    const result = await runClaireTurn({
      ...baseParams(),
      client,
      toolMap: echoToolMap(),
      sink: new SseSink((e) => captured.push(e)),
    });

    // The output the `echo` tool produced (data + presentation), exactly as
    // the loop assembles it for the tool-output-available frame.
    const echoOutput = {
      echoed: { msg: 'hey' },
      presentation: { type: 'preview_card', label: 'Echo' },
    };

    const expected: UIStreamEvent[] = [
      // ── Round 1 ──
      { type: 'start-step' },
      { type: 'text-start', id: 'uuid-1' },
      { type: 'text-delta', id: 'uuid-1', delta: 'Hi! ' },
      { type: 'text-end', id: 'uuid-1' },
      {
        type: 'tool-input-start',
        toolCallId: 'tool-1',
        toolName: 'echo',
        providerExecuted: true,
      },
      {
        type: 'tool-input-delta',
        toolCallId: 'tool-1',
        inputTextDelta: '{"msg":',
      },
      {
        type: 'tool-input-delta',
        toolCallId: 'tool-1',
        inputTextDelta: '"hey"}',
      },
      {
        type: 'tool-input-available',
        toolCallId: 'tool-1',
        toolName: 'echo',
        input: { msg: 'hey' },
        providerExecuted: true,
      },
      {
        type: 'tool-output-available',
        toolCallId: 'tool-1',
        output: echoOutput,
        providerExecuted: true,
      },
      { type: 'finish-step' },
      // ── Round 2 ──
      { type: 'start-step' },
      { type: 'text-start', id: 'uuid-2' },
      { type: 'text-delta', id: 'uuid-2', delta: 'Done.' },
      { type: 'text-end', id: 'uuid-2' },
      { type: 'finish-step' },
    ];

    expect(captured).toEqual(expected);
    expect(result.stopReason).toBe('end_turn');
    expect(result.rounds).toBe(2);
    expect(result.finalText).toBe('Done.');
    expect(result.toolParts).toEqual([
      {
        toolCallId: 'tool-1',
        toolName: 'echo',
        input: { msg: 'hey' },
        output: echoOutput,
      },
    ]);
  });

  it('runToolLoop shim produces an identical frame stream to a direct SseSink', async () => {
    // Drive the same script twice: once through the `runToolLoop` shim (emit),
    // once through `runClaireTurn` with an explicit `SseSink`. The two frame
    // arrays must be identical — proving the shim changes nothing on the wire.
    uuidCounter = 0;
    const shimFrames: UIStreamEvent[] = [];
    await runToolLoop({
      ...baseParams(),
      client: makeFakeClient(scriptedRounds()),
      toolMap: echoToolMap(),
      emit: (e) => shimFrames.push(e),
    });

    uuidCounter = 0;
    const directFrames: UIStreamEvent[] = [];
    await runClaireTurn({
      ...baseParams(),
      client: makeFakeClient(scriptedRounds()),
      toolMap: echoToolMap(),
      sink: new SseSink((e) => directFrames.push(e)),
    });

    expect(shimFrames).toEqual(directFrames);
  });

  it('a custom TurnSink observes the same semantic events (WS-2 forward-compat)', async () => {
    // Sanity that the seam is sink-agnostic: a hand-rolled collecting sink
    // sees the same method calls the SseSink translates to frames.
    uuidCounter = 0;
    const calls: string[] = [];
    const recordingSink: TurnSink = {
      onStepStart: () => calls.push('stepStart'),
      onStepFinish: () => calls.push('stepFinish'),
      onTextStart: () => calls.push('textStart'),
      onTextDelta: () => calls.push('textDelta'),
      onTextEnd: () => calls.push('textEnd'),
      onReasoningStart: () => calls.push('reasoningStart'),
      onReasoningDelta: () => calls.push('reasoningDelta'),
      onReasoningEnd: () => calls.push('reasoningEnd'),
      onToolInputStart: () => calls.push('toolInputStart'),
      onToolInputDelta: () => calls.push('toolInputDelta'),
      onToolInputAvailable: () => calls.push('toolInputAvailable'),
      onToolOutputAvailable: () => calls.push('toolOutputAvailable'),
      onToolOutputError: () => calls.push('toolOutputError'),
      onError: () => calls.push('error'),
    };

    await runClaireTurn({
      ...baseParams(),
      client: makeFakeClient(scriptedRounds()),
      toolMap: echoToolMap(),
      sink: recordingSink,
    });

    expect(calls).toEqual([
      'stepStart',
      'textStart',
      'textDelta',
      'textEnd',
      'toolInputStart',
      'toolInputDelta',
      'toolInputDelta',
      'toolInputAvailable',
      'toolOutputAvailable',
      'stepFinish',
      'stepStart',
      'textStart',
      'textDelta',
      'textEnd',
      'stepFinish',
    ]);
  });
});
