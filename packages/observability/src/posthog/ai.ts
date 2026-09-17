import { randomUUID } from 'node:crypto';
import {
  getCurrentOrganizationId,
  getObservabilityContext,
} from '../context.js';
import { getEnvProps, getPostHogClient } from './client.js';

/**
 * PostHog LLM observability.
 *
 * Emits the native `$ai_generation` and `$ai_embedding` events that power
 * PostHog's "LLM analytics" product (per-generation latency, token usage,
 * auto-calculated cost, input/output capture, trace grouping). See
 * https://posthog.com/docs/ai-observability for the event spec.
 *
 * These are emitted from the shared `@borradh-workspace/ai` chokepoints so
 * every LLM call in the workspace is tracked without per-call-site plumbing.
 * Attribution (acting user + trace id) is pulled from the ambient
 * observability context when the caller doesn't pass it explicitly.
 *
 * Prompt/response content is captured by default so traces are inspectable.
 * Set `POSTHOG_AI_CAPTURE_CONTENT=false` to redact `$ai_input` /
 * `$ai_output_choices` (token counts, latency and cost are still captured).
 */

const captureContent = (): boolean =>
  process.env.POSTHOG_AI_CAPTURE_CONTENT !== 'false';

export interface AiGenerationEvent {
  /** LLM provider, e.g. `openai`, `anthropic`, `gemini`. */
  provider: string;
  /** Model id, e.g. `gpt-4o`, `claude-sonnet-4-6`, `gemini-3-pro-image`. */
  model: string;
  /**
   * Distinct id for the event. Defaults to the ambient acting user, else the
   * organization (when `groups.organization` is set), else `ai-system`. When
   * it resolves to a non-user id the event is emitted person-less so it does
   * not spawn a nameless PostHog person.
   */
  distinctId?: string;
  /** Groups to attribute the event to, e.g. `{ organization: orgId }`. */
  groups?: Record<string, string>;
  /**
   * Trace id used to group related generations into one trace (e.g. a
   * conversation id or request id). Defaults to the ambient trace id, else a
   * fresh uuid so the generation still renders as a single-span trace.
   */
  traceId?: string;
  /** Human-readable span name for trace readability, e.g. `chatbots.generateAiResponse`. */
  spanName?: string;
  /** Input messages (`[{ role, content }]`) or a raw prompt string. */
  input?: unknown;
  /** Output choices, typically `[{ role: 'assistant', content }]`. */
  outputChoices?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  /** Anthropic prompt-cache read tokens (billed at a discount). */
  cacheReadInputTokens?: number;
  /** Anthropic prompt-cache write tokens. */
  cacheCreationInputTokens?: number;
  /** End-to-end latency in SECONDS (PostHog's `$ai_latency` unit). */
  latencySeconds?: number;
  /**
   * Explicit cost overrides, in USD. PostHog auto-calculates cost from token
   * counts using its model price catalog — but that only works for models in
   * the catalog that report token usage. Image models (e.g. `gemini-3-pro-image`)
   * are billed per-image and report no tokens over their REST endpoints, so
   * their cost resolves to $0. Pass an explicit cost here for those; when set,
   * it is emitted as `$ai_input_cost_usd` / `$ai_output_cost_usd` /
   * `$ai_total_cost_usd` and PostHog uses it instead of auto-pricing.
   */
  inputCostUsd?: number;
  outputCostUsd?: number;
  /** Total cost in USD; defaults to `inputCostUsd + outputCostUsd` when omitted. */
  totalCostUsd?: number;
  /** HTTP status of the upstream call (defaults to 200 on success). */
  httpStatus?: number;
  /** Upstream base URL, e.g. `https://api.openai.com/v1`. */
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
  /** Set true when the call failed; pair with `error`. */
  isError?: boolean;
  /** Error message when `isError` is true. */
  error?: string;
  /** Extra custom properties merged onto the event. */
  properties?: Record<string, unknown>;
}

export interface AiEmbeddingEvent {
  provider: string;
  model: string;
  distinctId?: string;
  groups?: Record<string, string>;
  traceId?: string;
  spanName?: string;
  input?: unknown;
  inputTokens?: number;
  latencySeconds?: number;
  httpStatus?: number;
  baseUrl?: string;
  isError?: boolean;
  error?: string;
  properties?: Record<string, unknown>;
}

interface ResolvedAttribution {
  distinctId: string;
  personless: boolean;
  traceId: string;
}

const resolveAttribution = (
  explicitDistinctId: string | undefined,
  explicitTraceId: string | undefined,
  groups: Record<string, string> | undefined
): ResolvedAttribution => {
  const ctx = getObservabilityContext();
  const userId = ctx?.userId;

  let distinctId: string;
  let personless: boolean;
  if (explicitDistinctId) {
    distinctId = explicitDistinctId;
    // An explicit id that matches the acting user gets a person profile;
    // anything else (org id, system) stays person-less.
    personless = !userId || explicitDistinctId !== userId;
  } else if (userId && userId !== 'anonymous') {
    distinctId = userId;
    personless = false;
  } else if (groups?.organization) {
    distinctId = groups.organization;
    personless = true;
  } else {
    distinctId = 'ai-system';
    personless = true;
  }

  const traceId = explicitTraceId ?? ctx?.traceId ?? randomUUID();
  return { distinctId, personless, traceId };
};

const isFiniteNumber = (n: number | undefined): n is number =>
  typeof n === 'number' && Number.isFinite(n);

/**
 * Resolve the PostHog groups for an event: explicit groups win, otherwise fall
 * back to the ambient request's organization so org rollups work for any AI
 * call made inside an authenticated request without call-site plumbing.
 */
const resolveGroups = (
  explicit: Record<string, string> | undefined
): Record<string, string> | undefined => {
  if (explicit) return explicit;
  const organization = getCurrentOrganizationId();
  return organization ? { organization } : undefined;
};

/**
 * Capture a single LLM generation as a PostHog `$ai_generation` event.
 *
 * No-ops gracefully (logs nothing) when PostHog is not initialized, so it is
 * safe to call unconditionally from shared library code. Never throws — any
 * failure to build/emit the event is swallowed so observability cannot break
 * the underlying AI call.
 */
export const captureAiGeneration = (event: AiGenerationEvent): void => {
  const client = getPostHogClient();
  if (!client) return;

  try {
    const groups = resolveGroups(event.groups);
    const { distinctId, personless, traceId } = resolveAttribution(
      event.distinctId,
      event.traceId,
      groups
    );

    const props: Record<string, unknown> = {
      ...getEnvProps(),
      $ai_trace_id: traceId,
      $ai_provider: event.provider,
      $ai_model: event.model,
      $ai_http_status: event.httpStatus ?? (event.isError ? 500 : 200),
    };

    if (event.spanName) props.$ai_span_name = event.spanName;
    if (event.baseUrl) props.$ai_base_url = event.baseUrl;
    if (isFiniteNumber(event.inputTokens))
      props.$ai_input_tokens = event.inputTokens;
    if (isFiniteNumber(event.outputTokens))
      props.$ai_output_tokens = event.outputTokens;
    if (isFiniteNumber(event.cacheReadInputTokens))
      props.$ai_cache_read_input_tokens = event.cacheReadInputTokens;
    if (isFiniteNumber(event.cacheCreationInputTokens))
      props.$ai_cache_creation_input_tokens = event.cacheCreationInputTokens;
    if (isFiniteNumber(event.latencySeconds))
      props.$ai_latency = event.latencySeconds;

    // Explicit cost overrides for models PostHog can't auto-price (per-image
    // image models that report no tokens). When provided, PostHog uses these
    // verbatim instead of computing from token counts.
    if (isFiniteNumber(event.inputCostUsd))
      props.$ai_input_cost_usd = event.inputCostUsd;
    if (isFiniteNumber(event.outputCostUsd))
      props.$ai_output_cost_usd = event.outputCostUsd;
    const totalCost = isFiniteNumber(event.totalCostUsd)
      ? event.totalCostUsd
      : isFiniteNumber(event.inputCostUsd) ||
          isFiniteNumber(event.outputCostUsd)
        ? (event.inputCostUsd ?? 0) + (event.outputCostUsd ?? 0)
        : undefined;
    if (isFiniteNumber(totalCost)) props.$ai_total_cost_usd = totalCost;

    const modelParams: Record<string, unknown> = {};
    if (isFiniteNumber(event.temperature))
      modelParams.temperature = event.temperature;
    if (isFiniteNumber(event.maxTokens))
      modelParams.max_tokens = event.maxTokens;
    if (Object.keys(modelParams).length > 0)
      props.$ai_model_parameters = modelParams;

    if (captureContent()) {
      if (event.input !== undefined) props.$ai_input = event.input;
      if (event.outputChoices !== undefined)
        props.$ai_output_choices = event.outputChoices;
    }

    if (event.isError) {
      props.$ai_is_error = true;
      if (event.error) props.$ai_error = event.error;
    }

    if (event.properties) Object.assign(props, event.properties);

    if (personless) props.$process_person_profile = false;

    client.capture({
      distinctId,
      event: '$ai_generation',
      properties: props,
      ...(groups ? { groups } : {}),
    });
  } catch {
    // Observability must never break the AI call it is measuring.
  }
};

/**
 * Capture an embedding generation as a PostHog `$ai_embedding` event.
 * Same no-op / never-throw guarantees as {@link captureAiGeneration}.
 */
export const captureAiEmbedding = (event: AiEmbeddingEvent): void => {
  const client = getPostHogClient();
  if (!client) return;

  try {
    const groups = resolveGroups(event.groups);
    const { distinctId, personless, traceId } = resolveAttribution(
      event.distinctId,
      event.traceId,
      groups
    );

    const props: Record<string, unknown> = {
      ...getEnvProps(),
      $ai_trace_id: traceId,
      $ai_provider: event.provider,
      $ai_model: event.model,
      $ai_http_status: event.httpStatus ?? (event.isError ? 500 : 200),
    };

    if (event.spanName) props.$ai_span_name = event.spanName;
    if (event.baseUrl) props.$ai_base_url = event.baseUrl;
    if (isFiniteNumber(event.inputTokens))
      props.$ai_input_tokens = event.inputTokens;
    if (isFiniteNumber(event.latencySeconds))
      props.$ai_latency = event.latencySeconds;

    if (captureContent() && event.input !== undefined)
      props.$ai_input = event.input;

    if (event.isError) {
      props.$ai_is_error = true;
      if (event.error) props.$ai_error = event.error;
    }

    if (event.properties) Object.assign(props, event.properties);

    if (personless) props.$process_person_profile = false;

    client.capture({
      distinctId,
      event: '$ai_embedding',
      properties: props,
      ...(groups ? { groups } : {}),
    });
  } catch {
    // Observability must never break the AI call it is measuring.
  }
};
