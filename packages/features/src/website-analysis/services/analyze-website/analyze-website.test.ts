import {
  chatCompletion,
  parseJsonResponse,
  safeGet,
  safeGetStringArray,
} from '@borradh-workspace/ai';
import { geocodeAddress } from '@borradh-workspace/integrations';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as browserRendererModule from './browser-renderer.js';
import * as mergedStrategyModule from './strategies/merged-strategy.js';

// browser-renderer is stubbed with a restored `vi.spyOn`, NOT `vi.mock`: under
// `isolate: false` a hoisted bare-factory mock leaks onto the shared worker
// module graph (deleting every export it omits) and silently misses whenever an
// earlier file already imported the real module. Spies install at run time and
// restore, so neither hazard applies.
let mockCreateBrowserSession: MockInstance;
let mockNeedsBrowserRendering: MockInstance;

// `node:dns/promises` is mocked via the canonical alias in vite.config.ts so the
// hardened SSRF guard (assertExternalUrl) resolves test hosts to a public IP
// offline. The `lookup` mock is shared across files under `isolate: false`, so
// its resolution is (re)established in beforeEach below — NOT with a file-local
// `vi.mock`, which collided with html.ts's SSRF tests on the shared worker graph.
import { lookup } from 'node:dns/promises';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { getRedis } from '@borradh-workspace/redis';
import {
  analyzeWebsite,
  getAnalyzeWebsiteJob,
  startAnalyzeWebsiteJob,
} from './analyze-website.service.js';

const mockChatCompletion = vi.mocked(chatCompletion);
const mockParseJsonResponse = vi.mocked(parseJsonResponse);
const mockRedis = vi.mocked(getRedis)();

// File-level so BOTH describe blocks get the stub (and the restore).
beforeEach(() => {
  mockCreateBrowserSession = vi
    .spyOn(browserRendererModule, 'createBrowserSession')
    .mockResolvedValue(null as never);
  mockNeedsBrowserRendering = vi
    .spyOn(browserRendererModule, 'needsBrowserRendering')
    .mockReturnValue(false as never);
});

afterEach(() => {
  mockCreateBrowserSession.mockRestore();
  mockNeedsBrowserRendering.mockRestore();
});

describe('analyzeWebsite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish the shared dns mock's public-IP resolution each test — a
    // sibling file (html.test.ts) resets the shared `lookup` mock, so relying on
    // the module-level default would be order-dependent.
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    // `safeGet` / `safeGetStringArray` are pure transformation helpers used
    // internally — restore their behaviour on the canonical AI mock.
    vi.mocked(safeGet).mockImplementation(
      (obj: Record<string, unknown>, key: string, fallback: string) =>
        typeof obj[key] === 'string' ? obj[key] : fallback
    );
    vi.mocked(safeGetStringArray).mockImplementation(
      (obj: Record<string, unknown>, key: string, _max: number) =>
        Array.isArray(obj[key]) ? obj[key] : []
    );
    vi.mocked(geocodeAddress).mockResolvedValue(null);
  });

  it('returns EXTERNAL_SERVICE_ERROR for invalid URL', async () => {
    mockFetch.mockRejectedValueOnce(new Error('fetch failed'));

    await expectResult(
      analyzeWebsite(
        { websiteUrl: 'not-a-url', organizationId: 'org_123' },
        'test-api-key'
      )
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('returns VALIDATION_ERROR for missing websiteUrl', async () => {
    await expectResult(
      analyzeWebsite(
        { websiteUrl: '', organizationId: 'org_123' },
        'test-api-key'
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns EXTERNAL_SERVICE_ERROR when API key is missing', async () => {
    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      undefined
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      expect(result.error.message).toContain('API key');
    }
  });

  it('returns EXTERNAL_SERVICE_ERROR when website fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      expect(result.error.message).toContain('Failed to fetch');
    }
  });

  it('returns VALIDATION_ERROR when website content is too short', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue('<html><body>Hi</body></html>'),
      headers: { get: vi.fn(), getSetCookie: vi.fn().mockReturnValue([]) },
    } as never);

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('too short');
    }
  });

  it('returns EXTERNAL_SERVICE_ERROR when AI returns no content', async () => {
    const longContent = `<html><body>${'A '.repeat(100)}</body></html>`;
    // Homepage fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(longContent),
      headers: { get: vi.fn(), getSetCookie: vi.fn().mockReturnValue([]) },
    } as never);
    // Sitemap fetch (404)
    mockFetch.mockRejectedValueOnce(new Error('404'));

    mockChatCompletion.mockResolvedValueOnce({
      content: null,
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    } as never);

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      expect(result.error.message).toContain('No response');
    }
  });

  it('returns an external-service error when OpenAI times out', async () => {
    const longContent = `<html><body>${'A '.repeat(100)}</body></html>`;
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(longContent),
      headers: { get: vi.fn(), getSetCookie: vi.fn().mockReturnValue([]) },
    } as never);
    mockFetch.mockRejectedValueOnce(new Error('404'));
    mockChatCompletion.mockRejectedValueOnce(new Error('Request timed out.'));

    await expectResult(
      analyzeWebsite(
        { websiteUrl: 'https://example.com', organizationId: 'org_123' },
        'test-api-key'
      )
    ).toFailWithCode(ErrorCodes.EXTERNAL_SERVICE_ERROR);
  });

  it('successfully analyzes a website', async () => {
    const htmlContent = `<html><body><p>We offer Botox, Fillers, and Laser treatments. ${'Our clinic is located in Dublin. We serve women aged 30-55. </p>'.repeat(
      5
    )}</body></html>`;

    // Homepage fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(htmlContent),
      headers: { get: vi.fn(), getSetCookie: vi.fn().mockReturnValue([]) },
    } as never);
    // Sitemap fetch (fail)
    mockFetch.mockRejectedValueOnce(new Error('404'));

    const aiResponse = {
      services: [{ name: 'Botox' }, { name: 'Fillers' }, { name: 'Laser' }],
      targetAudienceDescription: 'Women aged 30-55',
      brandVoice: ['professional', 'warm'],
      suggestedCredibilityLines: ['Trusted clinic'],
      primaryColor: '#7c3aed',
      secondaryColor: '#f5f5f5',
      locations: [],
    };

    mockChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify(aiResponse),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as never);

    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: aiResponse,
    } as never);

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services).toEqual([
        { name: 'Botox' },
        { name: 'Fillers' },
        { name: 'Laser' },
      ]);
      expect(result.data.targetAudienceDescription).toBe('Women aged 30-55');
    }
  });

  // --- ENG-828 ---------------------------------------------------------------
  // A customer's WAF started answering our plain fetch with 403 while Firecrawl
  // and Browser Use scraped the same site fine. The scan aborted at the fetch
  // and never reached them, so the feature was dead for that customer.

  it('recovers via enriched scraping when the native fetch is blocked', async () => {
    const mockMerged = vi
      .spyOn(mergedStrategyModule, 'runMergedStrategy')
      .mockResolvedValue({
        enrichedContent: `<h1>Zara Aesthetics</h1>${'We offer Botox and Fillers in Dublin. '.repeat(10)}`,
        mergedServices: [
          { name: 'Botox', pricingDescription: 'from EUR200' },
          { name: 'Fillers' },
        ],
        strategiesUsed: ['firecrawl', 'browser-use'],
      } as never);

    // Every fetch is blocked — the homepage 403 is what used to end the scan.
    mockFetch.mockRejectedValue(new Error('HTTP 403: Forbidden'));

    const aiResponse = {
      services: [{ name: 'Botox' }, { name: 'Fillers' }],
      targetAudienceDescription: 'Women aged 30-55',
      brandVoice: ['professional'],
      suggestedCredibilityLines: ['Trusted clinic'],
      primaryColor: '#7c3aed',
      secondaryColor: '#f5f5f5',
      locations: [],
    };
    mockChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify(aiResponse),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as never);
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: aiResponse,
    } as never);

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key',
      { firecrawlApiKey: 'fc-test-key' }
    );

    expect(mockMerged).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.services).toEqual([
        { name: 'Botox' },
        { name: 'Fillers' },
      ]);
    }

    mockMerged.mockRestore();
  });

  it('hard-fails on an SSRF redirect instead of handing the URL to enrichment', async () => {
    const mockMerged = vi
      .spyOn(mergedStrategyModule, 'runMergedStrategy')
      .mockResolvedValue({
        enrichedContent: `<h1>x</h1>${'content '.repeat(50)}`,
        mergedServices: [{ name: 'Botox' }],
        strategiesUsed: ['firecrawl'],
      } as never);

    // Public host, then a 302 to an internal address. The redirect hop's SSRF
    // check must stay terminal — degrading it to enrichment would hand a URL we
    // just refused to fetch to a third-party crawler.
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 302,
      text: vi.fn().mockResolvedValue(''),
      headers: {
        get: vi
          .fn()
          .mockReturnValue('http://169.254.169.254/latest/meta-data/'),
        getSetCookie: vi.fn().mockReturnValue([]),
      },
    } as never);

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key',
      { firecrawlApiKey: 'fc-test-key' }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('private network addresses');
    }
    // The whole point: enrichment must NOT have been reached.
    expect(mockMerged).not.toHaveBeenCalled();

    mockMerged.mockRestore();
  });

  it('still fails with the underlying fetch error when enrichment cannot recover', async () => {
    const mockMerged = vi
      .spyOn(mergedStrategyModule, 'runMergedStrategy')
      .mockResolvedValue({
        enrichedContent: '',
        mergedServices: [],
        strategiesUsed: [],
      } as never);

    mockFetch.mockRejectedValue(new Error('HTTP 403: Forbidden'));

    const result = await analyzeWebsite(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key',
      { firecrawlApiKey: 'fc-test-key' }
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      // The cause must survive to the user and the logs — not be flattened
      // into the generic "content is too short" message.
      expect(result.error.code).toBe(ErrorCodes.EXTERNAL_SERVICE_ERROR);
      expect(result.error.message).toContain('HTTP 403');
    }

    mockMerged.mockRestore();
  });
});

/** All job-status payloads written to Redis so far, in call order. */
const setJobPayloads = () =>
  mockRedis.set.mock.calls.map(
    (call) => JSON.parse(call[1] as string) as Record<string, unknown>
  );

describe('startAnalyzeWebsiteJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(lookup).mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
    ] as never);
    vi.mocked(safeGet).mockImplementation(
      (obj: Record<string, unknown>, key: string, fallback: string) =>
        typeof obj[key] === 'string' ? obj[key] : fallback
    );
    vi.mocked(safeGetStringArray).mockImplementation(
      (obj: Record<string, unknown>, key: string, _max: number) =>
        Array.isArray(obj[key]) ? obj[key] : []
    );
    vi.mocked(geocodeAddress).mockResolvedValue(null);
  });

  it('returns VALIDATION_ERROR for invalid input', async () => {
    const result = await startAnalyzeWebsiteJob(
      { websiteUrl: '', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(mockRedis.set).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR when the initial status write fails', async () => {
    mockRedis.set.mockRejectedValueOnce(new Error('redis down'));

    const result = await startAnalyzeWebsiteJob(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });

  it('writes a terminal error status when the analysis hangs past the watchdog', async () => {
    // Homepage fetch never settles — simulates any hung await in the pipeline
    // (wedged browser, hung scrape, unresponsive upstream).
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    const result = await startAnalyzeWebsiteJob(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key',
      undefined,
      { watchdogMs: 50 }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobId).toMatch(/^wa-job:/);
    }

    await vi.waitFor(
      () => {
        const terminal = setJobPayloads().find((p) => p.status === 'error');
        expect(terminal).toBeTruthy();
        expect(terminal?.error).toContain('timed out');
        expect(terminal?.organizationId).toBe('org_123');
      },
      { timeout: 3000 }
    );
  });

  it('writes a terminal error status when the analysis fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await startAnalyzeWebsiteJob(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(true);

    await vi.waitFor(
      () => {
        const terminal = setJobPayloads().find((p) => p.status === 'error');
        expect(terminal).toBeTruthy();
        expect(terminal?.error).toContain('Failed to fetch');
      },
      { timeout: 3000 }
    );
  });

  it('writes a terminal done status with the result on success', async () => {
    const htmlContent = `<html><body><p>We offer Botox, Fillers, and Laser treatments. ${'Our clinic is located in Dublin. We serve women aged 30-55. </p>'.repeat(
      5
    )}</body></html>`;

    // Homepage fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: vi.fn().mockResolvedValue(htmlContent),
      headers: { get: vi.fn(), getSetCookie: vi.fn().mockReturnValue([]) },
    } as never);
    // Sitemap fetch (fail)
    mockFetch.mockRejectedValueOnce(new Error('404'));

    const aiResponse = {
      services: [{ name: 'Botox' }],
      targetAudienceDescription: 'Women aged 30-55',
      brandVoice: ['professional'],
      suggestedCredibilityLines: [],
      locations: [],
    };

    mockChatCompletion.mockResolvedValueOnce({
      content: JSON.stringify(aiResponse),
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    } as never);
    mockParseJsonResponse.mockReturnValueOnce({
      success: true,
      data: aiResponse,
    } as never);

    const result = await startAnalyzeWebsiteJob(
      { websiteUrl: 'https://example.com', organizationId: 'org_123' },
      'test-api-key'
    );

    expect(result.success).toBe(true);

    await vi.waitFor(
      () => {
        const terminal = setJobPayloads().find((p) => p.status === 'done');
        expect(terminal).toBeTruthy();
        expect(
          (terminal?.result as { services: unknown[] } | undefined)?.services
        ).toEqual([{ name: 'Botox' }]);
      },
      { timeout: 3000 }
    );
  });
});

describe('getAnalyzeWebsiteJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the job status', async () => {
    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({ status: 'pending', phase: 'fetching' })
    );

    const result = await getAnalyzeWebsiteJob('wa-job:abc');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('pending');
      expect(result.data.phase).toBe('fetching');
    }
  });

  it('returns NOT_FOUND when the job key is missing or expired', async () => {
    mockRedis.get.mockResolvedValueOnce(null);

    const result = await getAnalyzeWebsiteJob('wa-job:missing');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it("never exposes another organization's job", async () => {
    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({
        status: 'done',
        phase: 'done',
        organizationId: 'org_a',
      })
    );

    const result = await getAnalyzeWebsiteJob('wa-job:abc', 'org_b');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('allows polling onboarding jobs started without an organization', async () => {
    mockRedis.get.mockResolvedValueOnce(
      JSON.stringify({ status: 'done', phase: 'done' })
    );

    const result = await getAnalyzeWebsiteJob('wa-job:abc', 'org_b');

    expect(result.success).toBe(true);
  });

  it('fails fast with INTERNAL_ERROR instead of hanging when Redis is unresponsive', async () => {
    // ioredis queues commands while reconnecting: the returned promise never
    // settles. The bounded read must convert that into a fast failure.
    mockRedis.get.mockReturnValueOnce(new Promise(() => {}) as never);

    const result = await getAnalyzeWebsiteJob('wa-job:abc');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  }, 10_000);
});
