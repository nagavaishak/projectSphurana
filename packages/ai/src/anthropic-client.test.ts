import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnthropicClient,
  getAnthropicClient,
  getAnthropicConfig,
  getDefaultAnthropicMaxTokens,
  getDefaultAnthropicModel,
  initAnthropicClient,
  isAnthropicClientInitialized,
  resetAnthropicClient,
} from './anthropic-client.js';

const FAKE_KEY = 'sk-ant-test-not-a-real-key';

describe('Anthropic client singleton', () => {
  beforeEach(() => {
    resetAnthropicClient();
  });

  afterEach(() => {
    resetAnthropicClient();
  });

  it('reports uninitialized before init', () => {
    expect(isAnthropicClientInitialized()).toBe(false);
  });

  it('throws when getAnthropicClient is called before init', () => {
    expect(() => getAnthropicClient()).toThrow(/not initialized/i);
  });

  it('initializes and exposes the singleton', () => {
    initAnthropicClient({ apiKey: FAKE_KEY });
    expect(isAnthropicClientInitialized()).toBe(true);
    const client = getAnthropicClient();
    expect(client).toBeDefined();
    // SDK exposes a `messages` namespace; verify the client wires through.
    expect(client.messages).toBeDefined();
  });

  it('returns the stored config', () => {
    initAnthropicClient({
      apiKey: FAKE_KEY,
      defaultModel: 'claude-opus-4-7',
      defaultMaxTokens: 8192,
    });
    expect(getAnthropicConfig()).toEqual({
      apiKey: FAKE_KEY,
      defaultModel: 'claude-opus-4-7',
      defaultMaxTokens: 8192,
    });
  });

  it('uses sane defaults when config does not override them', () => {
    expect(getDefaultAnthropicModel()).toBe('claude-sonnet-4-6');
    expect(getDefaultAnthropicMaxTokens()).toBe(4096);
  });

  it('honours overrides for model and max tokens', () => {
    initAnthropicClient({
      apiKey: FAKE_KEY,
      defaultModel: 'claude-haiku-4-5-20251001',
      defaultMaxTokens: 1024,
    });
    expect(getDefaultAnthropicModel()).toBe('claude-haiku-4-5-20251001');
    expect(getDefaultAnthropicMaxTokens()).toBe(1024);
  });

  it('reset clears state', () => {
    initAnthropicClient({ apiKey: FAKE_KEY });
    expect(isAnthropicClientInitialized()).toBe(true);
    resetAnthropicClient();
    expect(isAnthropicClientInitialized()).toBe(false);
    expect(getAnthropicConfig()).toBeNull();
  });
});

describe('createAnthropicClient (factory, no singleton)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('builds a client with the explicit key', () => {
    const client = createAnthropicClient(FAKE_KEY);
    expect(client).toBeDefined();
    expect(client.messages).toBeDefined();
  });

  it('falls back to ANTHROPIC_API_KEY when no key is provided', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', FAKE_KEY);
    const client = createAnthropicClient();
    expect(client).toBeDefined();
    expect(client.messages).toBeDefined();
  });

  it('throws when no key is available', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    expect(() => createAnthropicClient()).toThrow(/no API key/i);
  });

  it('does not affect the singleton', () => {
    resetAnthropicClient();
    createAnthropicClient(FAKE_KEY);
    expect(isAnthropicClientInitialized()).toBe(false);
  });
});
