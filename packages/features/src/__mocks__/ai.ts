/**
 * Canonical mock for `@borradh-workspace/ai`.
 *
 * Aliased in vite.config.ts so the real AI package (OpenAI + Anthropic SDK
 * clients) is never loaded in tests, and so every test file sees the *same*
 * mock — a prerequisite for `isolate: false`. See
 * docs/plans/features-test-isolation-windows.md.
 *
 * Test files should NOT `vi.mock('@borradh-workspace/ai')` — import the symbol
 * and drive it with `vi.mocked()`. `beforeEach(vi.clearAllMocks())` resets call
 * history between tests.
 */
import { vi } from 'vitest';

/**
 * Auto-vivifying proxy used for SDK client instances. Any property access
 * returns a stable `vi.fn()`, and nested namespaces (`client.messages.create`,
 * `client.chat.completions.create`, ...) are themselves proxies, so tests can
 * reach arbitrarily deep without this mock enumerating the SDK surface.
 *
 * The proxy is a STABLE shared object — there is no per-file
 * `mockImplementation` state to leak under `isolate: false`.
 */
const makeClientProxy = (): Record<string, unknown> => {
  const cache = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === 'then') return undefined; // not a thenable
        let value = cache.get(prop);
        if (!value) {
          // A callable proxy: usable both as a fn (`client.foo()`) and as a
          // namespace (`client.foo.bar()`).
          const fn = vi.fn();
          value = new Proxy(fn, {
            get(target, nestedProp: string) {
              if (nestedProp in target) {
                return (target as Record<string, unknown>)[nestedProp];
              }
              return makeClientProxy()[nestedProp];
            },
          });
          cache.set(prop, value);
        }
        return value;
      },
    }
  );
};

/** Stable shared OpenAI client object returned by the client getters. */
export const mockAIClient = makeClientProxy();
/** Stable shared Anthropic client object returned by the client getters. */
export const mockAnthropicClient = makeClientProxy();

// --- Client (OpenAI) ------------------------------------------------------
export const initAIClient = vi.fn();
export const getAIClient = vi.fn(() => mockAIClient);
export const getAIConfig = vi.fn();
export const isAIClientInitialized = vi.fn(() => true);
export const getDefaultModel = vi.fn(() => 'gpt-4o');
export const getDefaultMaxTokens = vi.fn(() => 4096);
export const resetAIClient = vi.fn();
export const createAIClient = vi.fn(() => mockAIClient);

/**
 * The model-tier table. NOT a `vi.fn()` — call sites read it as a plain
 * constant (`chatCompletion(prompt, { model: MODELS.cheap })`), so an absent
 * export here would only surface as a TypeError inside the call under test.
 * Mirrors `packages/ai/src/models.ts`.
 */
export const MODELS = {
  chat: 'gpt-5.6-luna',
  cheap: 'gpt-5.6-luna',
  vision: 'gpt-5.6-luna',
} as const;

// --- Client (Anthropic) ---------------------------------------------------
export const initAnthropicClient = vi.fn();
export const getAnthropicClient = vi.fn(() => mockAnthropicClient);
export const getAnthropicConfig = vi.fn();
export const isAnthropicClientInitialized = vi.fn(() => true);
export const getDefaultAnthropicModel = vi.fn(
  () => 'claude-sonnet-4-5-20250929'
);
export const getDefaultAnthropicMaxTokens = vi.fn(() => 8192);
export const resetAnthropicClient = vi.fn();
export const createAnthropicClient = vi.fn(() => mockAnthropicClient);

// --- Completions ----------------------------------------------------------
export const chatCompletion = vi.fn();
export const visionCompletion = vi.fn();
export const streamChatCompletion = vi.fn();

// --- Embeddings -----------------------------------------------------------
// Defaults to a single 3-d vector so a caller that embeds one string gets a
// usable value without every test having to stub it. Tests that care drive it
// with `vi.mocked(generateEmbeddings)`.
export const generateEmbeddings = vi.fn(async () => [[0.1, 0.2, 0.3]]);

// --- JSON parsing ---------------------------------------------------------
export const extractJson = vi.fn();
export const parseJsonResponse = vi.fn();
export const safeGet = vi.fn();
export const safeGetArray = vi.fn();
export const safeGetStringArray = vi.fn();

// --- Errors ---------------------------------------------------------------
export const isRateLimitError = vi.fn(() => false);
export const RATE_LIMIT_MESSAGE =
  'AI service is busy right now. Please try again in a moment.';

// --- Anthropic SDK default class ------------------------------------------
/**
 * `new Anthropic(...)` always returns the SAME `mockAnthropicClient` object, so
 * it is safe under a shared module registry — there is no per-file
 * `Anthropic.mockImplementation(...)` state to leak.
 */
export const Anthropic = vi.fn(() => mockAnthropicClient);
