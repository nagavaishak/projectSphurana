import { getRedis } from '@borradh-workspace/redis';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import type { MockInstance } from 'vitest';
import { vi } from 'vitest';

// `node:crypto` is intentionally NOT mocked: the real `createHash` is a pure,
// harmless computation here (it only builds a cache-key suffix that the tests
// never assert on — they match the `chatbot:web-cache:org-456:` prefix). Mocking
// a high-blast-radius builtin like `node:crypto` is force-banned by the ratchet.
const mockRedis = vi.mocked(getRedis)();

import { chatCompletion } from '@borradh-workspace/ai';
// The website-analysis helpers are stubbed with RESTORED `vi.spyOn`s (see
// beforeEach/afterEach). `packages/features` runs `isolate: false`, so a
// file-local `vi.mock` factory would persist on the shared worker module graph
// and leak into every later file importing these helpers. The spies target the
// SOURCE module (`utils/html.js`) rather than the `utils/index.js` barrel —
// barrel re-exports are live getters and cannot be redefined.
import * as websiteUtils from '../../website-analysis/utils/html.js';
import { createWebsiteFetchTool } from './website-fetch.tool.js';

const mockChatCompletion = vi.mocked(chatCompletion);
let mockFetchWebsite: MockInstance;
let mockExtractText: MockInstance;

const context = {
  organizationId: 'org-456',
  conversationId: 'conv-789',
};

describe('createWebsiteFetchTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWebsite = vi
      .spyOn(websiteUtils, 'fetchWebsiteContent')
      .mockResolvedValue(undefined as never);
    mockExtractText = vi
      .spyOn(websiteUtils, 'extractTextFromHtml')
      .mockReturnValue(undefined as never);
  });

  afterEach(() => {
    mockFetchWebsite.mockRestore();
    mockExtractText.mockRestore();
  });

  it('returns a tool with correct name and parameters', () => {
    const tool = createWebsiteFetchTool({});
    expect(tool.name).toBe('fetch_website');
    expect(tool.parameters.url).toBeDefined();
    expect(tool.parameters.query).toBeDefined();
  });

  it('returns error when url is missing', async () => {
    const tool = createWebsiteFetchTool({});
    const result = await tool.execute({ url: '', query: 'test' }, context);
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns error when query is missing', async () => {
    const tool = createWebsiteFetchTool({});
    const result = await tool.execute(
      { url: 'https://example.com', query: '' },
      context
    );
    expect(result.success).toBe(false);
    expect(result.error).toContain('required');
  });

  it('returns cached content when available', async () => {
    mockRedis.get.mockResolvedValueOnce('cached page text');
    mockChatCompletion.mockResolvedValueOnce({
      content: 'Summarized answer from cache',
    } as never);

    const tool = createWebsiteFetchTool({
      apiKey: 'test-key',
    });

    const result = await tool.execute(
      { url: 'https://example.com', query: 'opening hours' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('Summarized answer from cache');
    expect(mockFetchWebsite).not.toHaveBeenCalled();
  });

  it('fetches and caches content on cache miss', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockFetchWebsite.mockResolvedValueOnce('<html>Hello</html>');
    mockExtractText.mockReturnValueOnce('Hello page text');
    mockChatCompletion.mockResolvedValueOnce({
      content: 'Summarized fresh content',
    } as never);

    const tool = createWebsiteFetchTool({
      apiKey: 'test-key',
    });

    const result = await tool.execute(
      { url: 'https://example.com', query: 'pricing' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('Summarized fresh content');
    expect(mockFetchWebsite).toHaveBeenCalledWith('https://example.com');
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.stringContaining('chatbot:web-cache:org-456:'),
      'Hello page text',
      'EX',
      3600
    );
  });

  it('returns truncated raw text when no apiKey', async () => {
    mockRedis.get.mockResolvedValueOnce('some cached text');

    const tool = createWebsiteFetchTool({});

    const result = await tool.execute(
      { url: 'https://example.com', query: 'anything' },
      context
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('some cached text');
    expect(mockChatCompletion).not.toHaveBeenCalled();
  });

  it('returns error when fetch fails', async () => {
    mockRedis.get.mockResolvedValueOnce(null);
    mockFetchWebsite.mockRejectedValueOnce(new Error('Network error'));

    const tool = createWebsiteFetchTool({
      apiKey: 'test-key',
    });

    const result = await tool.execute(
      { url: 'https://example.com', query: 'clinic name' },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not fetch');
  });

  it('returns error on unexpected error in summarization', async () => {
    mockRedis.get.mockResolvedValueOnce('some text');
    mockChatCompletion.mockRejectedValueOnce(new Error('AI error'));

    const tool = createWebsiteFetchTool({
      apiKey: 'test-key',
    });

    const result = await tool.execute(
      { url: 'https://example.com', query: 'info' },
      context
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Website fetch failed');
  });
});
