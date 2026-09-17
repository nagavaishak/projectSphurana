/**
 * Eval CLI entry. Invoked by the root `pnpm test:eval-claire` script.
 *
 * Modes:
 *   - default: replay (CI). Reads recordings; doesn't touch Anthropic.
 *   - `EVAL_RECORD=1` + `ANTHROPIC_API_KEY` set: record. Hits Anthropic
 *     for real; overwrites recordings on success.
 *
 * Flags via env:
 *   - `EVAL_SERIAL=1`           force sequential execution
 *   - `EVAL_FILTER=<substring>` only run fixtures whose ID contains this
 *
 * @see ./README.md
 */

import type { LiveModelCallInput, LiveProvider } from './harness.js';
import { runEval } from './runner.js';
import type { EvalMode } from './types.js';

async function main(): Promise<void> {
  // `EVAL_MODE=live-controller` redirects to the apps/api adapter CLI. The
  // in-process runner can't host the live-controller path because features
  // can't import from apps/api (project-reference direction). Surface a
  // helpful message so anyone setting the env var sees the right command
  // rather than a silent fallthrough to in-process mode.
  if (process.env.EVAL_MODE === 'live-controller') {
    console.error(
      'Live-controller mode runs from apps/api. Use:\n' +
        '  pnpm test:eval-claire-live\n' +
        '(or `pnpm --filter=@borradh-workspace/api test:eval-live`)\n' +
        'In-process mode is the default `pnpm test:eval-claire`.'
    );
    process.exit(2);
  }

  const mode: EvalMode = process.env.EVAL_RECORD === '1' ? 'record' : 'replay';
  const serial = process.env.EVAL_SERIAL === '1';
  const only = process.env.EVAL_FILTER || undefined;

  let liveProvider: LiveProvider | undefined;
  if (mode === 'record') {
    liveProvider = await buildLiveProvider();
  }

  const summary = await runEval({
    mode,
    serial,
    only,
    liveProvider,
  });

  process.exit(summary.failed === 0 ? 0 : 1);
}

/**
 * Build the Anthropic-backed live provider. Imported lazily so the
 * default replay path doesn't pull in `@borradh-workspace/ai` (which
 * boots a singleton client on first access).
 */
export async function buildLiveProvider(): Promise<LiveProvider> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'EVAL_RECORD=1 requires ANTHROPIC_API_KEY to be set. Drop the flag for replay mode.'
    );
  }
  const { createAnthropicClient } = await import('@borradh-workspace/ai');
  const client = createAnthropicClient();
  // The model preference is per-turn; the harness passes it through. We
  // map sonnet/opus to the current model IDs locked in claire.md §2.
  const SONNET_MODEL = 'claude-sonnet-4-5';
  const OPUS_MODEL = 'claude-opus-4-7';

  return {
    callModel: async (input: LiveModelCallInput) => {
      const model = input.preferredModel === 'opus' ? OPUS_MODEL : SONNET_MODEL;
      const response = await client.messages.create({
        model,
        max_tokens: 4096,
        // The Anthropic SDK accepts a `system` array of TextBlockParam,
        // which is structurally compatible with our AnthropicSystemBlock.
        system: input.systemBlocks as never,
        // Tools are referenced by name only; the live recording captures
        // the model's tool_use calls. The factory's tool definitions
        // (with full input_schemas) live in apps/api and aren't in scope
        // for this prep harness — the controller adapter in
        // W-C04-A-finish wires them in.
        tools: input.toolNames.map((name: string) => ({
          name,
          description: '',
          input_schema: {
            type: 'object',
            properties: {},
            additionalProperties: true,
          },
        })) as never,
        messages: input.messages as never,
      });
      const text = extractText(response.content);
      const toolUses = extractToolUses(response.content);
      const stopReason = (response.stop_reason ?? 'end_turn') as
        | 'end_turn'
        | 'tool_use'
        | 'max_tokens'
        | 'pause_turn';
      return { modelText: text, toolUses, stopReason };
    },
  };
}

/**
 * Shape we need out of the Anthropic SDK's `Message.content`. The SDK's
 * actual `ContentBlock[]` includes `ThinkingBlock`, `RedactedThinkingBlock`
 * and others we don't read. Walk it as an unknown array and pluck only the
 * text + tool_use shapes the harness cares about.
 */
type AnyContentBlock = { type: string; [k: string]: unknown };

function asContentBlocks(value: unknown): AnyContentBlock[] {
  return Array.isArray(value)
    ? (value.filter(
        (b): b is AnyContentBlock =>
          !!b &&
          typeof b === 'object' &&
          typeof (b as { type: unknown }).type === 'string'
      ) as AnyContentBlock[])
    : [];
}

function extractText(content: unknown): string {
  const blocks = asContentBlocks(content).filter((b) => b.type === 'text');
  return blocks.map((b) => (typeof b.text === 'string' ? b.text : '')).join('');
}

function extractToolUses(
  content: unknown
): { name: string; input: Record<string, unknown> }[] {
  const out: { name: string; input: Record<string, unknown> }[] = [];
  for (const block of asContentBlocks(content)) {
    if (block.type !== 'tool_use') continue;
    const name = typeof block.name === 'string' ? block.name : '';
    const rawInput = block.input;
    const input =
      rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)
        ? (rawInput as Record<string, unknown>)
        : {};
    if (name) out.push({ name, input });
  }
  return out;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
