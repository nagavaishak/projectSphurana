import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Fake posthog-node client capturing emitted events.
const capture = vi.fn();

// Mutable ambient observability context for the resolveAttribution tests.
let ambient: { userId?: string; traceId?: string; organizationId?: string } =
  {};

vi.mock('./client.js', () => ({
  getPostHogClient: () => ({ capture }),
  getEnvProps: () => ({ environment: 'test' }),
}));

vi.mock('../context.js', () => ({
  getObservabilityContext: () => ambient,
  getCurrentOrganizationId: () => ambient.organizationId,
}));

import { captureAiEmbedding, captureAiGeneration } from './ai.js';

const lastProps = () => capture.mock.calls.at(-1)?.[0]?.properties;
const lastCall = () => capture.mock.calls.at(-1)?.[0];

describe('captureAiGeneration', () => {
  beforeEach(() => {
    capture.mockClear();
    ambient = {};
    process.env.POSTHOG_AI_CAPTURE_CONTENT = '';
  });
  afterEach(() => {
    process.env.POSTHOG_AI_CAPTURE_CONTENT = '';
  });

  it('emits a $ai_generation event with model, provider, tokens and latency', () => {
    captureAiGeneration({
      provider: 'openai',
      model: 'gpt-4o',
      input: [{ role: 'user', content: 'hi' }],
      outputChoices: [{ role: 'assistant', content: 'hello' }],
      inputTokens: 10,
      outputTokens: 5,
      latencySeconds: 1.5,
      distinctId: 'user_1',
    });

    expect(capture).toHaveBeenCalledTimes(1);
    const call = lastCall();
    expect(call.event).toBe('$ai_generation');
    expect(call.distinctId).toBe('user_1');
    const props = call.properties;
    expect(props.$ai_provider).toBe('openai');
    expect(props.$ai_model).toBe('gpt-4o');
    expect(props.$ai_input_tokens).toBe(10);
    expect(props.$ai_output_tokens).toBe(5);
    expect(props.$ai_latency).toBe(1.5);
    expect(props.$ai_http_status).toBe(200);
    expect(props.environment).toBe('test');
    expect(props.$ai_trace_id).toBeTruthy();
  });

  it('flags errors with $ai_is_error and a 500 status', () => {
    captureAiGeneration({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      isError: true,
      error: 'boom',
    });
    const props = lastProps();
    expect(props.$ai_is_error).toBe(true);
    expect(props.$ai_error).toBe('boom');
    expect(props.$ai_http_status).toBe(500);
  });

  it('defaults distinctId + groups from the ambient org when not a real user', () => {
    ambient = { organizationId: 'org_42' };
    captureAiGeneration({ provider: 'openai', model: 'gpt-4o' });
    const call = lastCall();
    expect(call.distinctId).toBe('org_42');
    expect(call.groups).toEqual({ organization: 'org_42' });
    // No acting user → person-less so it doesn't create a nameless person.
    expect(call.properties.$process_person_profile).toBe(false);
  });

  it('uses the ambient acting user as a person-profile distinctId', () => {
    ambient = { userId: 'user_9' };
    captureAiGeneration({ provider: 'openai', model: 'gpt-4o' });
    const call = lastCall();
    expect(call.distinctId).toBe('user_9');
    expect(call.properties.$process_person_profile).toBeUndefined();
  });

  it('redacts input/output when POSTHOG_AI_CAPTURE_CONTENT=false', () => {
    process.env.POSTHOG_AI_CAPTURE_CONTENT = 'false';
    captureAiGeneration({
      provider: 'openai',
      model: 'gpt-4o',
      input: [{ role: 'user', content: 'secret' }],
      outputChoices: [{ role: 'assistant', content: 'reply' }],
      inputTokens: 3,
    });
    const props = lastProps();
    expect(props.$ai_input).toBeUndefined();
    expect(props.$ai_output_choices).toBeUndefined();
    // Token counts still captured for cost.
    expect(props.$ai_input_tokens).toBe(3);
  });

  it('carries Anthropic cache token counts when present', () => {
    captureAiGeneration({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      cacheReadInputTokens: 100,
      cacheCreationInputTokens: 20,
    });
    const props = lastProps();
    expect(props.$ai_cache_read_input_tokens).toBe(100);
    expect(props.$ai_cache_creation_input_tokens).toBe(20);
  });

  it('emits explicit cost props for models PostHog cannot auto-price', () => {
    captureAiGeneration({
      provider: 'gemini',
      model: 'gemini-3-pro-image',
      inputCostUsd: 0.0022,
      outputCostUsd: 0.134,
    });
    const props = lastProps();
    expect(props.$ai_input_cost_usd).toBe(0.0022);
    expect(props.$ai_output_cost_usd).toBe(0.134);
    // total defaults to input + output when not given explicitly
    expect(props.$ai_total_cost_usd).toBeCloseTo(0.1362, 6);
  });

  it('prefers an explicit totalCostUsd over the input+output sum', () => {
    captureAiGeneration({
      provider: 'gemini',
      model: 'gemini-3-pro-image',
      outputCostUsd: 0.134,
      totalCostUsd: 0.2,
    });
    expect(lastProps().$ai_total_cost_usd).toBe(0.2);
  });

  it('omits cost props entirely when no cost is supplied (token auto-pricing)', () => {
    captureAiGeneration({
      provider: 'openai',
      model: 'gpt-4o',
      inputTokens: 5,
    });
    const props = lastProps();
    expect(props.$ai_input_cost_usd).toBeUndefined();
    expect(props.$ai_output_cost_usd).toBeUndefined();
    expect(props.$ai_total_cost_usd).toBeUndefined();
  });
});

describe('captureAiEmbedding', () => {
  beforeEach(() => {
    capture.mockClear();
    ambient = {};
  });

  it('emits a $ai_embedding event with token usage', () => {
    captureAiEmbedding({
      provider: 'openai',
      model: 'text-embedding-3-small',
      inputTokens: 42,
      latencySeconds: 0.2,
    });
    const call = lastCall();
    expect(call.event).toBe('$ai_embedding');
    expect(call.properties.$ai_input_tokens).toBe(42);
    expect(call.properties.$ai_latency).toBe(0.2);
  });
});
