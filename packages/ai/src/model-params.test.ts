import { describe, expect, it } from 'vitest';
import { buildSamplingParams, isReasoningModel } from './model-params.js';

describe('isReasoningModel', () => {
  it('identifies the GPT-5.x family', () => {
    expect(isReasoningModel('gpt-5.6-luna')).toBe(true);
    expect(isReasoningModel('gpt-5.6')).toBe(true);
  });

  it('identifies dated snapshots by prefix', () => {
    expect(isReasoningModel('gpt-5.6-luna-2026-07-09')).toBe(true);
  });

  it('identifies the o-series', () => {
    expect(isReasoningModel('o3-mini')).toBe(true);
  });

  it('does not treat the GPT-4 family as reasoning models', () => {
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('gpt-4.1-mini')).toBe(false);
    expect(isReasoningModel('gpt-3.5-turbo')).toBe(false);
  });
});

describe('buildSamplingParams — GPT-4 family', () => {
  it('keeps max_tokens and temperature', () => {
    expect(
      buildSamplingParams({
        model: 'gpt-4o',
        maxTokens: 1000,
        temperature: 0.7,
      })
    ).toEqual({ max_tokens: 1000, temperature: 0.7 });
  });

  it('omits temperature when the caller did not set one', () => {
    const params = buildSamplingParams({ model: 'gpt-4o', maxTokens: 500 });
    expect(params).toEqual({ max_tokens: 500 });
    expect('temperature' in params).toBe(false);
  });

  it('ignores reasoningEffort', () => {
    const params = buildSamplingParams({
      model: 'gpt-4o',
      maxTokens: 500,
      reasoningEffort: 'high',
    });
    expect('reasoning_effort' in params).toBe(false);
  });
});

describe('buildSamplingParams — reasoning family', () => {
  it('uses max_completion_tokens, never max_tokens', () => {
    const params = buildSamplingParams({
      model: 'gpt-5.6-luna',
      maxTokens: 1000,
    });
    // Sending `max_tokens` to a reasoning model is a hard 400 from the API.
    expect('max_tokens' in params).toBe(false);
    expect(params.max_completion_tokens).toBeDefined();
  });

  it('DROPS temperature — the API rejects it outright', () => {
    const params = buildSamplingParams({
      model: 'gpt-5.6-luna',
      maxTokens: 1000,
      temperature: 0.7,
    });
    expect('temperature' in params).toBe(false);
  });

  it('defaults to low effort', () => {
    expect(
      buildSamplingParams({ model: 'gpt-5.6-luna', maxTokens: 1000 })
        .reasoning_effort
    ).toBe('low');
  });

  it('adds reasoning headroom on top of the caller budget', () => {
    // The caller's number must keep meaning "room for the visible answer".
    // Passing it through verbatim lets reasoning eat the whole allowance and
    // return finish_reason=length with EMPTY content — a silent blank reply.
    const params = buildSamplingParams({
      model: 'gpt-5.6-luna',
      maxTokens: 1000,
      reasoningEffort: 'low',
    });
    expect(params.max_completion_tokens).toBe(1000 + 2000);
  });

  it('scales headroom with effort', () => {
    const at = (effort: 'none' | 'low' | 'medium' | 'high') =>
      buildSamplingParams({
        model: 'gpt-5.6-luna',
        maxTokens: 1000,
        reasoningEffort: effort,
      }).max_completion_tokens as number;

    expect(at('none')).toBe(1000);
    expect(at('low')).toBeLessThan(at('medium'));
    expect(at('medium')).toBeLessThan(at('high'));
  });

  it('adds no headroom at effort none', () => {
    // `none` disables reasoning, so the budget is the answer budget exactly.
    expect(
      buildSamplingParams({
        model: 'gpt-5.6-luna',
        maxTokens: 800,
        reasoningEffort: 'none',
      })
    ).toEqual({ max_completion_tokens: 800, reasoning_effort: 'none' });
  });
});
