import type Anthropic from '@anthropic-ai/sdk';
import {
  captureAiEmbedding,
  captureAiGeneration,
} from '@borradh-workspace/observability';
import type OpenAI from 'openai';

/**
 * Client-level LLM observability instrumentation.
 *
 * We wrap the SDK's non-streaming request methods in place at client-creation
 * time so EVERY caller — the `chatCompletion` / `anthropicChatCompletion` /
 * embeddings wrappers AND code that calls `client.messages.create(...)` /
 * `client.chat.completions.create(...)` directly — emits a PostHog
 * `$ai_generation` / `$ai_embedding` event with model, token usage, latency
 * and (auto-calculated) cost, without per-call-site plumbing.
 *
 * Streaming requests are passed through untouched here; they are instrumented
 * explicitly where they're consumed (`streamChatCompletion`, the assistant
 * `runToolLoop`) because usage only arrives at the end of the stream.
 *
 * Callers may optionally attach `posthog*` fields to the request body to
 * enrich the event (distinct id, trace id, span name, groups). They are
 * stripped before the body reaches the SDK. When omitted, attribution falls
 * back to the ambient observability context (acting user + trace id).
 */

const PROVIDER_OPENAI = 'openai';
const PROVIDER_ANTHROPIC = 'anthropic';

interface PosthogParams {
  posthogDistinctId?: string;
  posthogTraceId?: string;
  posthogSpanName?: string;
  posthogGroups?: Record<string, string>;
  posthogProperties?: Record<string, unknown>;
}

const POSTHOG_KEYS: (keyof PosthogParams)[] = [
  'posthogDistinctId',
  'posthogTraceId',
  'posthogSpanName',
  'posthogGroups',
  'posthogProperties',
];

/**
 * OpenAI `usage` payload, including the detail blocks the SDK types expose
 * but this instrumentation previously ignored.
 */
interface OpenAiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/**
 * Map OpenAI usage onto the capture event's token fields.
 *
 * `cached_tokens` is the fix for a real mispricing: OpenAI serves repeated
 * prompt prefixes from cache at a large discount (10x on GPT-5.x — $0.02 vs
 * $0.20 per 1M on Luna), but we never reported it, so PostHog priced every
 * input token at the full uncached rate. On a chatbot that resends a large
 * system prompt every turn, that overstates spend substantially.
 *
 * NOTE on `$ai_cache_reporting_exclusive`: OpenAI's `cached_tokens` are a
 * SUBSET of `prompt_tokens` (inclusive), whereas Anthropic reports cache
 * tokens separately (exclusive). PostHog auto-detects this from the provider,
 * so we report the raw numbers and let it apply the right arithmetic — do NOT
 * subtract them from `inputTokens` here.
 */
function openaiUsage(usage: unknown): {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
} {
  const u = (usage ?? {}) as OpenAiUsage;
  return {
    inputTokens: u.prompt_tokens,
    outputTokens: u.completion_tokens,
    cacheReadInputTokens: u.prompt_tokens_details?.cached_tokens,
  };
}

/**
 * Extra properties describing the reasoning portion of a GPT-5.x generation.
 *
 * Reasoning tokens are billed as output tokens and are already inside
 * `completion_tokens`, so cost stays correct without this — but without it you
 * cannot tell how much of the bill is thinking versus answering, which is the
 * number you need to tune `reasoning_effort`.
 */
function reasoningProperties(
  usage: unknown,
  request: Record<string, unknown>
): Record<string, unknown> {
  const reasoningTokens = (usage as OpenAiUsage | undefined)
    ?.completion_tokens_details?.reasoning_tokens;
  const effort = request.reasoning_effort;
  const out: Record<string, unknown> = {};
  if (typeof reasoningTokens === 'number') {
    out.reasoningTokens = reasoningTokens;
  }
  if (typeof effort === 'string') out.reasoningEffort = effort;
  return out;
}

/** Pull any `posthog*` enrichment fields off the request body. */
function extractPosthog(body: unknown): {
  ph: PosthogParams;
  clean: Record<string, unknown>;
} {
  if (!body || typeof body !== 'object') {
    return { ph: {}, clean: (body ?? {}) as Record<string, unknown> };
  }
  const clean = { ...(body as Record<string, unknown>) };
  const ph: PosthogParams = {};
  for (const key of POSTHOG_KEYS) {
    if (key in clean) {
      // biome-ignore lint/suspicious/noExplicitAny: heterogeneous param map
      (ph as any)[key] = clean[key];
      delete clean[key];
    }
  }
  return { ph, clean };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === 'number' ? status : undefined;
}

function baseUrlOf(client: { baseURL?: string }): string | undefined {
  return typeof client.baseURL === 'string' ? client.baseURL : undefined;
}

/** Normalize Anthropic `system` (string | text blocks) + messages into one input array. */
function anthropicInput(clean: Record<string, unknown>): unknown {
  const messages = Array.isArray(clean.messages) ? clean.messages : [];
  const system = clean.system;
  if (!system) return messages;
  const systemText =
    typeof system === 'string'
      ? system
      : Array.isArray(system)
        ? system
            .map((b) =>
              b && typeof b === 'object'
                ? ((b as { text?: string }).text ?? '')
                : ''
            )
            .join('')
        : '';
  return [{ role: 'system', content: systemText }, ...messages];
}

/**
 * Wrap an OpenAI client's chat-completion and embedding create methods to emit
 * PostHog LLM observability events. Mutates the client in place and returns it.
 */
export function instrumentOpenAI(client: OpenAI): OpenAI {
  const completions = client.chat.completions;
  const origCreate = completions.create.bind(completions);

  // NOTE: this MUST NOT be an `async` function. The SDK's `create` returns an
  // `APIPromise` (a thenable with extra methods like `.withResponse()`, used by
  // the streaming helpers). An `async` wrapper returns a plain `Promise`,
  // stripping those methods and breaking `client.chat.completions.create(...)`
  // callers that rely on them (e.g. streaming). We call the original, attach
  // capture via `.then`, and return the ORIGINAL APIPromise untouched.
  // biome-ignore lint/suspicious/noExplicitAny: preserving SDK overloads at runtime
  (completions as any).create = (body: any, options?: any) => {
    const { ph, clean } = extractPosthog(body);
    // biome-ignore lint/suspicious/noExplicitAny: passthrough APIPromise
    const apiPromise: any = origCreate(clean as any, options);

    // Streaming is instrumented by the consumer (usage arrives at stream end).
    if (clean.stream) return apiPromise;

    const start = Date.now();
    apiPromise.then(
      (response: { model?: string; choices?: unknown; usage?: unknown }) => {
        captureAiGeneration({
          provider: PROVIDER_OPENAI,
          model: response?.model ?? (clean.model as string),
          input: clean.messages,
          outputChoices: Array.isArray(response?.choices)
            ? response.choices.map((c: { message?: unknown }) => c.message)
            : undefined,
          ...openaiUsage(response?.usage),
          latencySeconds: (Date.now() - start) / 1000,
          baseUrl: baseUrlOf(client),
          temperature: clean.temperature as number | undefined,
          // Reasoning models send `max_completion_tokens`; GPT-4 sends
          // `max_tokens`. Report whichever the request actually carried.
          maxTokens: (clean.max_tokens ?? clean.max_completion_tokens) as
            | number
            | undefined,
          distinctId: ph.posthogDistinctId,
          traceId: ph.posthogTraceId,
          spanName: ph.posthogSpanName,
          groups: ph.posthogGroups,
          properties: {
            ...ph.posthogProperties,
            ...reasoningProperties(response?.usage, clean),
          },
        });
      },
      (error: unknown) => {
        captureAiGeneration({
          provider: PROVIDER_OPENAI,
          model: clean.model as string,
          input: clean.messages,
          latencySeconds: (Date.now() - start) / 1000,
          baseUrl: baseUrlOf(client),
          isError: true,
          error: errorMessage(error),
          httpStatus: errorStatus(error),
          distinctId: ph.posthogDistinctId,
          traceId: ph.posthogTraceId,
          spanName: ph.posthogSpanName,
          groups: ph.posthogGroups,
          properties: ph.posthogProperties,
        });
      }
    );
    return apiPromise;
  };

  const origEmbed = client.embeddings.create.bind(client.embeddings);
  // Non-async for the same APIPromise-preservation reason as `create` above.
  // biome-ignore lint/suspicious/noExplicitAny: preserving SDK overloads at runtime
  (client.embeddings as any).create = (body: any, options?: any) => {
    const { ph, clean } = extractPosthog(body);
    // biome-ignore lint/suspicious/noExplicitAny: passthrough APIPromise
    const apiPromise: any = origEmbed(clean as any, options);
    const start = Date.now();
    apiPromise.then(
      (response: { model?: string; usage?: { prompt_tokens?: number } }) => {
        captureAiEmbedding({
          provider: PROVIDER_OPENAI,
          model: response?.model ?? (clean.model as string),
          input: clean.input,
          inputTokens: response?.usage?.prompt_tokens,
          latencySeconds: (Date.now() - start) / 1000,
          baseUrl: baseUrlOf(client),
          distinctId: ph.posthogDistinctId,
          traceId: ph.posthogTraceId,
          spanName: ph.posthogSpanName,
          groups: ph.posthogGroups,
          properties: ph.posthogProperties,
        });
      },
      (error: unknown) => {
        captureAiEmbedding({
          provider: PROVIDER_OPENAI,
          model: clean.model as string,
          input: clean.input,
          latencySeconds: (Date.now() - start) / 1000,
          baseUrl: baseUrlOf(client),
          isError: true,
          error: errorMessage(error),
          httpStatus: errorStatus(error),
          distinctId: ph.posthogDistinctId,
          traceId: ph.posthogTraceId,
          spanName: ph.posthogSpanName,
          groups: ph.posthogGroups,
          properties: ph.posthogProperties,
        });
      }
    );
    return apiPromise;
  };

  return client;
}

/**
 * Wrap an Anthropic client's `messages.create` to emit PostHog LLM
 * observability events. Streaming (`messages.stream`, or `create` with
 * `stream: true`) is passed through — instrument it at the consumer. Mutates
 * the client in place and returns it.
 */
export function instrumentAnthropic(client: Anthropic): Anthropic {
  const messages = client.messages;
  const origCreate = messages.create.bind(messages);

  // NOTE: this MUST NOT be an `async` function. `messages.create` returns an
  // `APIPromise` and the SDK's `messages.stream()` helper calls
  // `messages.create(...).withResponse()` internally. An `async` wrapper
  // returns a plain `Promise` (no `.withResponse()`), which throws
  // "messages.create(...).withResponse is not a function" and breaks EVERY
  // streamed turn (incl. Claire's `runToolLoop`). Return the original
  // APIPromise untouched; attach capture via `.then`.
  // biome-ignore lint/suspicious/noExplicitAny: preserving SDK overloads at runtime
  (messages as any).create = (body: any, options?: any) => {
    const { ph, clean } = extractPosthog(body);
    // biome-ignore lint/suspicious/noExplicitAny: passthrough APIPromise
    const apiPromise: any = origCreate(clean as any, options);

    // Streaming is instrumented by the consumer (usage arrives at stream end).
    if (clean.stream) return apiPromise;

    const start = Date.now();
    apiPromise.then(
      (response: {
        model?: string;
        content?: unknown;
        usage?: Record<string, number>;
      }) => {
        const text = Array.isArray(response?.content)
          ? response.content
              .filter((b: { type?: string }) => b.type === 'text')
              .map((b: { text?: string }) => b.text ?? '')
              .join('')
          : '';
        captureAiGeneration({
          provider: PROVIDER_ANTHROPIC,
          model: response?.model ?? (clean.model as string),
          input: anthropicInput(clean),
          outputChoices: [{ role: 'assistant', content: text }],
          inputTokens: response?.usage?.input_tokens,
          outputTokens: response?.usage?.output_tokens,
          cacheReadInputTokens:
            response?.usage?.cache_read_input_tokens ?? undefined,
          cacheCreationInputTokens:
            response?.usage?.cache_creation_input_tokens ?? undefined,
          latencySeconds: (Date.now() - start) / 1000,
          baseUrl: baseUrlOf(client),
          temperature: clean.temperature as number | undefined,
          maxTokens: clean.max_tokens as number | undefined,
          distinctId: ph.posthogDistinctId,
          traceId: ph.posthogTraceId,
          spanName: ph.posthogSpanName,
          groups: ph.posthogGroups,
          properties: ph.posthogProperties,
        });
      },
      (error: unknown) => {
        captureAiGeneration({
          provider: PROVIDER_ANTHROPIC,
          model: clean.model as string,
          input: anthropicInput(clean),
          latencySeconds: (Date.now() - start) / 1000,
          baseUrl: baseUrlOf(client),
          maxTokens: clean.max_tokens as number | undefined,
          isError: true,
          error: errorMessage(error),
          httpStatus: errorStatus(error),
          distinctId: ph.posthogDistinctId,
          traceId: ph.posthogTraceId,
          spanName: ph.posthogSpanName,
          groups: ph.posthogGroups,
          properties: ph.posthogProperties,
        });
      }
    );
    return apiPromise;
  };

  return client;
}
