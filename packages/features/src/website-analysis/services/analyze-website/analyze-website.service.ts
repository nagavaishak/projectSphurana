/**
 * Website Analysis Service
 *
 * Fetches HTML content from a business website and uses AI to extract
 * key information for onboarding:
 * - Services offered
 * - Target audience description
 * - Brand voice characteristics
 * - Suggested credibility lines
 * - Brand colors
 * - Logo URL
 */

import { createHash } from 'node:crypto';
import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { geocodeAddress } from '@borradh-workspace/integrations';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';

import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { BlockedUrlError, assertExternalUrl } from '../../utils/html.js';
import {
  type AnalysisSection,
  type AnalyzeWebsiteInput,
  type AnalyzeWebsiteResponse,
  analyzeWebsiteResponseSchema,
  analyzeWebsiteSchema,
} from './analyze-website.schema.js';
import {
  type BrowserSession,
  createBrowserSession,
  needsBrowserRendering,
} from './browser-renderer.js';

import { SCRAPER_USER_AGENT } from '../../utils/user-agent.js';
import {
  buildAnalysisPrompt,
  parseAnalysisResponse,
  resolveScanSections,
} from './ai-analysis.js';
import { fetchBookingSystemContent } from './booking-discovery.js';
// Extracted modules
import { extractTextFromHtml } from './extract-html-metadata.js';
import { extractJsonLdLocations } from './extract-structured-data.js';
import {
  extractBrandColorsFromImage,
  extractColorsFromHtml,
  extractLogoFromHtml,
  filterBrandColors,
} from './extract-visual-assets.js';
import {
  discoverAndFetchSubpages,
  discoverLocationUrls,
  discoverTeamUrls,
  fetchAndExtractLocationContent,
  fetchTeamPageContent,
} from './location-discovery.js';
import { fetchFirecrawlScreenshot } from './strategies/firecrawl-strategy.js';
import { runMergedStrategy } from './strategies/merged-strategy.js';
import type { MergedStrategyConfig } from './strategies/types.js';

const logger = createLogger('WebsiteAnalysis');

const CACHE_PREFIX = 'wa';
const CACHE_TTL_SECONDS = 86400; // 24 hours
const REDIS_OP_TIMEOUT_MS = 2000; // fail-open if Redis is unreachable/slow

// ioredis queues commands while it (re)connects, so a downed Redis makes
// `await redis.get(...)` hang forever instead of rejecting — which would stall
// the whole analysis. Bound every cache op so the try/catch can actually fail open.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('redis timeout')), ms)
    ),
  ]);
}

/**
 * `scanFor` is part of the key, not just the URL: a scan narrowed to services
 * produces a result with no locations, hours or team. Keyed on the URL alone,
 * that thin result would be served to the next FULL scan of the same site as a
 * cache hit — and the caller would read the missing sections as "your website
 * doesn't say", which is a lie. Different scope, different entry.
 */
function cacheKey(url: string, scanFor?: readonly AnalysisSection[]): string {
  // Normalize: lowercase hostname, strip protocol, strip trailing slash
  const parsed = new URL(url);
  const normalized = `${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
  const scope = resolveScanSections(scanFor).join(',');
  const hash = createHash('sha256')
    .update(`${normalized}|${scope}`)
    .digest('hex')
    .slice(0, 16);
  return `${CACHE_PREFIX}:${hash}`;
}

/**
 * Terminal error for "we could not get any usable content for this site".
 *
 * Distinguishes the two ways that happens, because they need different user
 * action: a blocked/failed fetch that enrichment could not rescue is an
 * upstream problem, whereas a page that genuinely loaded but said nothing is a
 * bad URL. Reporting the underlying fetch failure also means the cause reaches
 * the logs and Sentry instead of being flattened into a generic message.
 */
function noNativeContentError(nativeFetchError?: string): FeatureError {
  return nativeFetchError
    ? new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        `Failed to fetch website: ${nativeFetchError}`
      )
    : new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Website content is too short to analyze. Please check the URL.'
      );
}

/**
 * Fetch HTML content from a URL with timeout and error handling.
 *
 * SSRF protection is delegated to the hardened `assertExternalUrl` in the
 * shared html util (DNS-resolves the host and rejects internal/loopback/
 * link-local/metadata/CGNAT addresses, rejects non-canonical IP literals,
 * and is re-applied on every redirect below).
 */
async function fetchWebsiteContent(url: string): Promise<string> {
  await assertExternalUrl(url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout
  const maxRedirects = 5;

  try {
    let currentUrl = url;
    const cookies = new Map<string, string>();

    for (let i = 0; i <= maxRedirects; i++) {
      const cookieHeader = [...cookies.values()].join('; ');
      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': SCRAPER_USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
        },
      });

      // Collect Set-Cookie headers
      const setCookies = response.headers.getSetCookie?.() ?? [];
      for (const sc of setCookies) {
        const [nameValue] = sc.split(';');
        const eqIdx = nameValue.indexOf('=');
        if (eqIdx > 0) {
          const name = nameValue.slice(0, eqIdx).trim();
          cookies.set(name, nameValue.trim());
        }
      }

      // Follow redirects manually to preserve cookies
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          throw new Error(
            `Redirect ${response.status} without Location header`
          );
        }
        currentUrl = new URL(location, currentUrl).href;
        await assertExternalUrl(currentUrl);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    }

    throw new Error('Too many redirects');
  } finally {
    clearTimeout(timeout);
  }
}

export type AnalyzeWebsitePhase =
  | 'pending'
  | 'fetching'
  | 'discovering'
  | 'analyzing'
  | 'done'
  | 'error';

type OnPhase = (phase: AnalyzeWebsitePhase) => void;

/**
 * Fetch a (Firecrawl-hosted) image URL into a Buffer for pixel analysis.
 * Bounded by a timeout; returns null on any failure so callers degrade.
 */
async function fetchImageBuffer(
  url: string,
  timeoutMs = 10000
): Promise<Buffer | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Derive brand colors from a rendered homepage screenshot.
 *
 * Primary source is local headless Chromium (no API key). If that's
 * unavailable (e.g. distroless prod with no browser) and a Firecrawl key
 * exists, fall back to a Firecrawl screenshot. Returns [] if neither works.
 */
async function extractScreenshotColors(
  websiteUrl: string,
  localScreenshot: Buffer | null,
  scrapingConfig: MergedStrategyConfig | undefined,
  logger: ReturnType<typeof createLogger>
): Promise<string[]> {
  if (localScreenshot) {
    const colors = await extractBrandColorsFromImage(localScreenshot);
    if (colors.length > 0) {
      logger.info(`[analyze] screenshot palette (local): ${colors.join(', ')}`);
      return colors;
    }
  }

  if (scrapingConfig?.firecrawlApiKey) {
    const shotUrl = await fetchFirecrawlScreenshot(
      websiteUrl,
      scrapingConfig.firecrawlApiKey
    );
    if (shotUrl) {
      const buf = await fetchImageBuffer(shotUrl);
      if (buf) {
        const colors = await extractBrandColorsFromImage(buf);
        if (colors.length > 0) {
          logger.info(
            `[analyze] screenshot palette (firecrawl): ${colors.join(', ')}`
          );
          return colors;
        }
      }
    }
  }

  return [];
}

/**
 * Analyze website implementation
 */
const analyzeWebsiteImpl = async (
  input: AnalyzeWebsiteInput,
  apiKey?: string,
  onPhase: OnPhase = () => {},
  scrapingConfig?: MergedStrategyConfig
): Promise<Result<AnalyzeWebsiteResponse>> => {
  // Validate input
  const parsed = analyzeWebsiteSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    websiteUrl,
    facebookPageUrl,
    bookingSystemUrl,
    forceRefresh,
    scanFor,
  } = parsed.data;

  // Check Redis cache (fail-open: errors are silently caught)
  if (!forceRefresh) {
    try {
      const redis = getRedis();
      const cacheId = bookingSystemUrl
        ? `${websiteUrl}|${bookingSystemUrl}`
        : websiteUrl;
      const cached = await withTimeout(
        redis.get(cacheKey(cacheId, scanFor)),
        REDIS_OP_TIMEOUT_MS
      );
      if (cached) {
        // Parsed, not cast: entries written before a field was added carry the
        // OLD shape, and the schema's `.default([])` is what backfills the
        // array fields (`locations`, `practitioners`, `packages`) that
        // consumers iterate. A cast would hand them `undefined`.
        const revived = analyzeWebsiteResponseSchema.safeParse(
          JSON.parse(cached)
        );
        if (revived.success) {
          logger.info(`Cache hit for ${websiteUrl}`);
          return ok(revived.data);
        }
        logger.warn(
          `Discarding unparseable cached analysis for ${websiteUrl} — re-analyzing`
        );
      }
    } catch {
      // Redis unavailable — proceed with fresh analysis
    }
  }

  // Check for API key
  if (!apiKey) {
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        'OpenAI API key not configured'
      )
    );
  }

  // Initialize AI client if needed
  if (!isAIClientInitialized()) {
    initAIClient({ apiKey });
  }

  // Declared outside try so it can be cleaned up in catch
  let browserSession: BrowserSession | null = null;

  // Shared deps for location/booking discovery
  const discoveryDeps = () => ({
    fetchContent: fetchWebsiteContent,
    browserSession,
    needsBrowserRendering,
    logger,
  });

  try {
    // Fetch website content
    onPhase('fetching');
    let websiteHtml = '';
    let websiteText = '';
    let nativeFetchError: string | undefined;
    try {
      websiteHtml = await fetchWebsiteContent(websiteUrl);
      websiteText = extractTextFromHtml(websiteHtml);
    } catch (error) {
      // SSRF rejection — terminal, always. `fetchWebsiteContent` re-runs the
      // check on every redirect hop, so this covers a host that only resolves
      // internally after a redirect, not just the URL we were handed. Degrading
      // it to enrichment would swap a clear, alertable "private network
      // addresses are not allowed" for a generic scraping warning, and would
      // hand a URL we just refused to fetch to a third-party crawler.
      if (error instanceof BlockedUrlError) {
        return err(
          new FeatureError(
            ErrorCodes.VALIDATION_ERROR,
            `Invalid website URL: ${error.message}`
          )
        );
      }

      // NOT fatal. Anti-bot WAFs answer our plain fetch with 403/503 while the
      // enrichment strategies — which crawl from their own browsers and egress
      // IPs, and don't send our User-Agent — fetch the same page fine. ENG-828:
      // a single 403 here used to abort the whole scan even though Firecrawl
      // and Browser Use had scraped that exact site days earlier.
      //
      // Fall through with empty content and let the thin-content handling below
      // decide, so a blocked fetch degrades to enrichment instead of failing.
      nativeFetchError =
        error instanceof Error ? error.message : 'Unknown error';
      logger.warn(
        `[analyze] native fetch failed (${nativeFetchError}) — relying on enriched scraping`
      );
    }

    const nativeContentTooShort = websiteText.length < 50;
    const hasScrapingKeys =
      scrapingConfig?.firecrawlApiKey ||
      (scrapingConfig?.browserbaseApiKey &&
        scrapingConfig?.browserbaseProjectId) ||
      scrapingConfig?.browserUseApiKey;

    // A thin — or entirely absent, when the fetch above was blocked — native
    // result is expected for SPA / JS-rendered / anti-bot sites. Only bail now
    // if there's no enrichment fallback; otherwise let the merged strategy
    // (Firecrawl/Browserbase/Browser-Use) pull the real content and re-check
    // after enrichment.
    if (nativeContentTooShort && !hasScrapingKeys) {
      return err(noNativeContentError(nativeFetchError));
    }

    if (nativeContentTooShort && !nativeFetchError) {
      logger.warn(
        '[analyze] native fetch returned thin content — relying on enriched scraping'
      );
    }

    // Extract colors, logo, and location data from HTML. The logo from native
    // HTML is a fallback — the rendered-DOM header logo (resolved below) is
    // preferred, since JS-rendered shells have no logo <img> and their
    // og:image is often a hero photo rather than the logo.
    let extractedColors = extractColorsFromHtml(websiteHtml);
    let extractedLogo = extractLogoFromHtml(websiteHtml, websiteUrl);
    const homepageJsonLd = extractJsonLdLocations(websiteHtml);

    // Create a shared browser session for SPA rendering (location pages + booking system)
    try {
      browserSession = await createBrowserSession({ timeoutMs: 12000 });
      if (browserSession) {
        logger.info('[analyze] browser session available for SPA fallback');
      }
    } catch {
      // Browser not available — proceed without SPA rendering
    }

    // Kick off brand-styling capture concurrently with discovery. Computed DOM
    // colors (buttons/CTAs/header/theme vars) are the reliable brand-color
    // source for JS-rendered sites, where the native HTML inlines no CSS.
    // Awaited later, before the session is closed.
    const emptySignals = {
      computedColors: [] as string[],
      logoUrl: null as string | null,
      screenshot: null as Buffer | null,
    };
    const brandSignalsPromise = browserSession
      ? browserSession.captureBrandSignals(websiteUrl).catch(() => emptySignals)
      : Promise.resolve(emptySignals);

    onPhase('discovering');
    // Discover and fetch location subpages
    let locationPageText: string | undefined;
    let subpageJsonLd = '';
    try {
      const locationUrls = await discoverLocationUrls(
        websiteUrl,
        websiteHtml,
        discoveryDeps()
      );
      logger.info(
        `[analyze] discovered ${locationUrls.length} location URLs: ${JSON.stringify(locationUrls)}`
      );
      if (locationUrls.length > 0) {
        const locationContent = await fetchAndExtractLocationContent(
          locationUrls,
          discoveryDeps()
        );
        logger.info(
          `[analyze] location content: textLen=${locationContent.text.length} jsonLdLen=${locationContent.jsonLd.length}`
        );
        if (locationContent.text) locationPageText = locationContent.text;
        subpageJsonLd = locationContent.jsonLd;
      }
    } catch (locationError) {
      logger.warn(
        `[analyze] location discovery failed: ${locationError instanceof Error ? locationError.message : String(locationError)}`
      );
    }

    // Combine JSON-LD from homepage and subpages
    const jsonLdLocations = [homepageJsonLd, subpageJsonLd]
      .filter(Boolean)
      .join('\n');
    logger.info(
      `[analyze] final location data: homepageJsonLd=${homepageJsonLd.length} subpageJsonLd=${subpageJsonLd.length} locationPageText=${locationPageText?.length ?? 0}`
    );

    // Discover and fetch team/about pages
    let teamPageText: string | undefined;
    try {
      const teamUrls = discoverTeamUrls(websiteUrl, websiteHtml);
      logger.info(
        `[analyze] discovered ${teamUrls.length} team URLs: ${JSON.stringify(teamUrls)}`
      );
      if (teamUrls.length > 0) {
        const teamContent = await fetchTeamPageContent(
          teamUrls,
          fetchWebsiteContent
        );
        if (teamContent) teamPageText = teamContent;
        logger.info(
          `[analyze] team page content: ${teamPageText?.length ?? 0} chars`
        );
      }
    } catch (teamError) {
      logger.warn(
        `[analyze] team page discovery failed: ${teamError instanceof Error ? teamError.message : String(teamError)}`
      );
    }

    // Discover and fetch key subpages (nav links + sitemap)
    let subpageTexts: string | undefined;
    try {
      const subpageContent = await discoverAndFetchSubpages(
        websiteUrl,
        websiteHtml,
        fetchWebsiteContent,
        logger
      );
      if (subpageContent) subpageTexts = subpageContent;
      logger.info(
        `[analyze] subpage content: ${subpageTexts?.length ?? 0} chars`
      );
    } catch (subpageError) {
      logger.warn(
        `[analyze] subpage discovery failed: ${subpageError instanceof Error ? subpageError.message : String(subpageError)}`
      );
    }

    // Fetch Facebook content if provided
    let facebookText: string | undefined;
    if (facebookPageUrl) {
      try {
        const facebookHtml = await fetchWebsiteContent(facebookPageUrl);
        facebookText = extractTextFromHtml(facebookHtml).slice(0, 5000);
      } catch {
        // Facebook fetch is optional, don't fail if it errors
        facebookText = undefined;
      }
    }

    // Fetch booking system content if provided (skip if same as website URL)
    let bookingSystemText: string | undefined;
    if (bookingSystemUrl && bookingSystemUrl !== websiteUrl) {
      try {
        bookingSystemText = await fetchBookingSystemContent(
          bookingSystemUrl,
          discoveryDeps()
        );
        logger.info(
          `[analyze] booking system content: ${bookingSystemText?.length ?? 0} chars`
        );
      } catch {
        // Booking system fetch is optional, don't fail if it errors
        bookingSystemText = undefined;
      }
    }

    // Collect brand-styling signals before tearing down the browser.
    const brandSignals = await brandSignalsPromise;

    // Close browser session now that all rendering is done
    try {
      await browserSession?.close();
    } catch {
      // Ignore close errors
    }

    // Resolve brand colors. Prefer computed DOM colors (the brand's actual
    // button/header/theme colors, ranked by prominence); only if that yields
    // nothing (e.g. no local Chromium) fall back to a screenshot palette.
    let brandColors = filterBrandColors(brandSignals.computedColors);
    if (brandColors.length > 0) {
      logger.info(
        `[analyze] brand colors (computed DOM): ${brandColors.join(', ')}`
      );
    } else {
      brandColors = await extractScreenshotColors(
        websiteUrl,
        brandSignals.screenshot,
        scrapingConfig,
        logger
      );
    }
    // Prepend — the AI is told to prefer the earliest extracted colors over
    // guessing a generic palette.
    if (brandColors.length > 0) {
      extractedColors = [...new Set([...brandColors, ...extractedColors])];
    }

    // Prefer the rendered-DOM header logo over the native-HTML fallback.
    if (brandSignals.logoUrl) {
      extractedLogo = brandSignals.logoUrl;
      logger.info(`[analyze] logo (rendered DOM): ${brandSignals.logoUrl}`);
    }

    // --- Enriched scraping (Firecrawl + Browserbase + OCR) ---
    let enrichedContent: string | undefined;
    let enrichedServiceHints: string | undefined;

    if (hasScrapingKeys) {
      try {
        // biome-ignore lint/style/noNonNullAssertion: hasScrapingKeys implies scrapingConfig is set
        const merged = await runMergedStrategy(websiteUrl, scrapingConfig!);
        if (merged.enrichedContent) {
          enrichedContent = merged.enrichedContent;
        }
        if (merged.mergedServices.length > 0) {
          enrichedServiceHints = merged.mergedServices
            .map((s) => {
              const price = s.pricingDescription
                ? ` — ${s.pricingDescription}`
                : '';
              return `- ${s.name}${price}`;
            })
            .join('\n');
        }
        logger.info(
          `[analyze] enriched scraping: strategies=[${merged.strategiesUsed.join(', ')}], ` +
            `content=${merged.enrichedContent.length} chars, ` +
            `serviceHints=${merged.mergedServices.length}`
        );
      } catch (error) {
        logger.warn(
          `[analyze] enriched scraping failed, continuing with native: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }

    // If the native fetch was thin AND enrichment couldn't recover usable
    // content either, there's genuinely nothing to analyze — fail clearly.
    const enrichedUsable =
      (enrichedContent && enrichedContent.length >= 50) ||
      !!enrichedServiceHints;
    if (nativeContentTooShort && !enrichedUsable) {
      return err(noNativeContentError(nativeFetchError));
    }

    // Analyze with AI
    onPhase('analyzing');
    const prompt = buildAnalysisPrompt(
      websiteText,
      facebookText,
      extractedColors,
      jsonLdLocations || undefined,
      locationPageText,
      teamPageText,
      subpageTexts,
      bookingSystemText,
      enrichedContent,
      enrichedServiceHints,
      scanFor
    );

    // A rich site yields 100+ services, each with a name, a long
    // pricingDescription and a structured price — plus locations,
    // practitioners and credibility lines. That does not fit in 4000 tokens:
    // the JSON was cut mid-object and surfaced as "Failed to parse AI response
    // as JSON", so the BETTER the scrape, the more likely the analysis failed.
    // gpt-4.1 allows 32k output; 16k covers the largest sites seen in prod.
    const ANALYSIS_MAX_TOKENS = 16000;
    const response = await chatCompletion(prompt, {
      maxTokens: ANALYSIS_MAX_TOKENS,
      jsonResponse: true,
      // The shared 60s default is appropriate for short assistant turns, not
      // this intentionally large structured extraction. One 90s attempt plus
      // one retry remains below the four-minute job watchdog.
      timeoutMs: 90_000,
      maxRetries: 1,
    });

    // Truncation still produces syntactically invalid JSON in JSON mode, so
    // name it explicitly rather than letting the parser report a generic
    // failure that gives no clue the cap was the cause.
    if (response.finishReason === 'length') {
      logger.error(
        `[analyze] AI response truncated at the ${ANALYSIS_MAX_TOKENS} token cap ` +
          `(${response.content?.length ?? 0} chars returned)`
      );
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'This website has more content than we can analyze in one pass. Please fill in the details manually.'
        )
      );
    }

    if (!response.content) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'No response from AI analysis'
        )
      );
    }

    const analysisResult = parseAnalysisResponse(
      response.content,
      extractedLogo,
      logger,
      scanFor
    );

    // Geocode extracted locations in parallel
    if (analysisResult.locations && analysisResult.locations.length > 0) {
      const geocodedLocations = await Promise.all(
        analysisResult.locations.map(async (loc) => {
          const addressParts = [
            loc.addressLine1,
            loc.city,
            loc.county,
            loc.postalCode,
            loc.country,
          ].filter(Boolean);
          const coords = await geocodeAddress(addressParts.join(', '));
          return coords
            ? { ...loc, latitude: coords.latitude, longitude: coords.longitude }
            : loc;
        })
      );
      analysisResult.locations = geocodedLocations;
    }

    // Store result in Redis cache (fail-open)
    try {
      const redis = getRedis();
      const storeCacheId = bookingSystemUrl
        ? `${websiteUrl}|${bookingSystemUrl}`
        : websiteUrl;
      await withTimeout(
        redis.set(
          cacheKey(storeCacheId, scanFor),
          JSON.stringify(analysisResult),
          'EX',
          CACHE_TTL_SECONDS
        ),
        REDIS_OP_TIMEOUT_MS
      );
      logger.info(`Cached analysis result for ${websiteUrl}`);
    } catch {
      // Redis unavailable — result still returned, just not cached
    }

    return ok(analysisResult);
  } catch (error) {
    // Ensure browser session is closed on error
    try {
      await browserSession?.close();
    } catch {
      // Ignore close errors
    }

    logError('website-analysis.analyzeWebsite', error, {
      feature: 'website-analysis',
      extra: { websiteUrl },
    });

    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message.includes('rate limit') || message.includes('429')) {
      return err(
        new FeatureError(
          ErrorCodes.RATE_LIMITED,
          'AI service is temporarily busy. Please try again in a moment.'
        )
      );
    }

    if (message.toLowerCase().includes('timed out')) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          'AI analysis took too long. Please try again in a moment.'
        )
      );
    }

    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to analyze website')
    );
  }
};

/**
 * Analyze a website to extract business information for onboarding
 */
export const analyzeWebsite = (
  input: AnalyzeWebsiteInput,
  apiKey?: string,
  scrapingConfig?: MergedStrategyConfig
) =>
  trackedResult(
    'website-analysis.analyzeWebsite',
    () => analyzeWebsiteImpl(input, apiKey, undefined, scrapingConfig),
    {
      properties: { websiteUrl: input.websiteUrl },
    }
  );

export type AnalyzeWebsiteResult = Awaited<ReturnType<typeof analyzeWebsite>>;

// ---------------------------------------------------------------------------
// Async job-based API (start + poll)
// ---------------------------------------------------------------------------

const ANALYZE_JOB_PREFIX = 'wa-job';
const ANALYZE_JOB_TTL = 600; // 10 minutes

/**
 * Hard cap on job runtime. The analysis pipeline fans out to many external
 * systems (site fetches, headless Chromium, Firecrawl/Browserbase/Browser-Use,
 * OpenAI, geocoding); if ANY await in that chain fails to settle, the job would
 * otherwise sit at status 'pending' until its Redis key expires and pollers get
 * an unexplained 404 — the onboarding UI then hangs on "Analysing" with no
 * terminal state to react to. The watchdog guarantees a terminal status.
 *
 * Must stay under both the frontend poll deadline (5 min in
 * useAnalyzeWebsite) and ANALYZE_JOB_TTL (10 min) so pollers always observe
 * the terminal status rather than timing out or hitting an expired key.
 */
const ANALYZE_JOB_WATCHDOG_MS = 240_000; // 4 minutes

export interface AnalyzeWebsiteJobStatus {
  status: 'pending' | 'done' | 'error';
  phase: AnalyzeWebsitePhase;
  /**
   * Organization that owns this job, when there is one.
   *
   * Absent during onboarding: the website scanner runs several steps before
   * the organization is created. Polling is scoped only when this is set.
   */
  organizationId?: string;
  /**
   * The sections this scan actually asked for, resolved (so `packages` already
   * implies `services`). Persisted because the apply stage must distinguish
   * "your website doesn't list a team" from "we never looked for one" — an
   * empty array means the same thing in both cases, and only this says which.
   */
  scanFor?: AnalysisSection[];
  result?: AnalyzeWebsiteResponse;
  error?: string;
}

async function setJobStatus(
  jobId: string,
  status: AnalyzeWebsiteJobStatus
): Promise<void> {
  const redis = getRedis();
  // Bounded like the cache ops above: ioredis queues commands while it
  // (re)connects, so an unhealthy Redis would otherwise hang this await —
  // and with it the start endpoint or the job's terminal-status write.
  await withTimeout(
    redis.set(jobId, JSON.stringify(status), 'EX', ANALYZE_JOB_TTL),
    REDIS_OP_TIMEOUT_MS
  );
}

export interface StartAnalyzeWebsiteJobOptions {
  /**
   * Hard cap on job runtime before the job is failed with a terminal 'error'
   * status. Defaults to ANALYZE_JOB_WATCHDOG_MS; overridable for tests.
   */
  watchdogMs?: number;
}

/**
 * Start a website analysis as a background job.
 * Returns a jobId immediately; poll getAnalyzeWebsiteJob() for status + result.
 *
 * Termination guarantee: the job ALWAYS reaches a terminal status ('done' or
 * 'error') within `watchdogMs` — a hung await anywhere in the analysis
 * pipeline can no longer strand the job at 'pending' (which left the
 * onboarding UI stuck on "Analysing" with nothing to react to).
 */
export async function startAnalyzeWebsiteJob(
  input: AnalyzeWebsiteInput,
  apiKey?: string,
  scrapingConfig?: MergedStrategyConfig,
  options?: StartAnalyzeWebsiteJobOptions
): Promise<Result<{ jobId: string }>> {
  const parsed = analyzeWebsiteSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { organizationId } = parsed.data;
  // Resolved once and stamped on every status write: the apply stage reads it
  // to tell "not on their website" from "we never looked".
  const scanFor = resolveScanSections(parsed.data.scanFor);
  const watchdogMs = options?.watchdogMs ?? ANALYZE_JOB_WATCHDOG_MS;
  const jobId = `${ANALYZE_JOB_PREFIX}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  try {
    await setJobStatus(jobId, {
      status: 'pending',
      phase: 'pending',
      organizationId,
      scanFor,
    });
  } catch {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create job')
    );
  }

  // Run in background — don't await
  void (async () => {
    // Set once a terminal status is written. A timed-out impl keeps running
    // detached; its late phase callbacks must not resurrect the job back to
    // 'pending' after the watchdog already failed it.
    let finished = false;

    const onPhase: OnPhase = (phase) => {
      if (finished) return;
      // Fire-and-forget — phase update failures shouldn't kill the job
      void setJobStatus(jobId, {
        status: 'pending',
        phase,
        organizationId,
        scanFor,
      }).catch(() => {});
    };

    const writeTerminal = async (
      status: AnalyzeWebsiteJobStatus
    ): Promise<void> => {
      finished = true;
      await setJobStatus(jobId, status);
    };

    let watchdogTimer: ReturnType<typeof setTimeout> | undefined;
    const watchdog = new Promise<'watchdog'>((resolve) => {
      watchdogTimer = setTimeout(() => resolve('watchdog'), watchdogMs);
      watchdogTimer.unref?.();
    });

    try {
      const raced = await Promise.race([
        // Routed through trackedResult like the synchronous `analyzeWebsite`
        // export. Without it the job path — the one production actually uses —
        // emitted no Sentry breadcrumb and no PostHog event, so a failed scan
        // left no trace anywhere (ENG-828).
        trackedResult(
          'website-analysis.analyzeWebsite',
          () => analyzeWebsiteImpl(input, apiKey, onPhase, scrapingConfig),
          {
            properties: {
              websiteUrl: input.websiteUrl,
              organizationId,
              jobId,
            },
          }
        ),
        watchdog,
      ]);

      if (raced === 'watchdog') {
        logger.error(
          `[wa-job] ${jobId} exceeded ${watchdogMs}ms without settling — failing the job`
        );
        await writeTerminal({
          status: 'error',
          phase: 'error',
          organizationId,
          scanFor,
          error:
            'Website analysis timed out. You can fill in the details manually.',
        });
        return;
      }

      if (raced.success) {
        await writeTerminal({
          status: 'done',
          phase: 'done',
          organizationId,
          scanFor,
          result: raced.data,
        });
      } else {
        // Log it. This branch used to write the terminal status silently, so a
        // Result-shaped failure produced no log line, no Sentry issue and no
        // PostHog event — a customer-facing scan could fail four times in a row
        // and the only record was the session replay (ENG-828).
        if (raced.error.code === ErrorCodes.VALIDATION_ERROR) {
          // Expected user error (bad URL, empty site) — worth a log line, not
          // worth paging anyone.
          logger.warn(
            `[wa-job] ${jobId} failed: ${raced.error.code} — ${raced.error.message}`
          );
        } else {
          logError('website-analysis.analyzeWebsiteJob', raced.error, {
            feature: 'website-analysis',
            extra: {
              jobId,
              organizationId,
              websiteUrl: input.websiteUrl,
              code: raced.error.code,
            },
          });
        }
        await writeTerminal({
          status: 'error',
          phase: 'error',
          organizationId,
          scanFor,
          error: raced.error.message,
        });
      }
    } catch (error) {
      try {
        await writeTerminal({
          status: 'error',
          phase: 'error',
          organizationId,
          scanFor,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      } catch {
        // Redis unavailable
      }
      logger.error(
        `[wa-job] ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer);
    }
  })();

  return ok({ jobId });
}

/**
 * A job as stored, with its result offered BOTH ways.
 *
 * The two consumers want different things from a result that no longer matches
 * the current shape, so the read hands over both rather than deciding for them.
 */
export interface AnalyzeWebsiteJobRecord {
  /** Client-safe view: `result` is strict-parsed, or dropped if it won't parse. */
  status: AnalyzeWebsiteJobStatus;
  /**
   * The result EXACTLY as stored, unparsed — `undefined` only when the job
   * genuinely carries none.
   *
   * The apply stage owns a deliberately lenient schema
   * (`websiteAnalysisSnapshotSchema`, every field `.catch()`-guarded) built to
   * salvage a drifted snapshot field by field. Handing it the strict-parsed
   * view would starve it: one malformed section would arrive as "no result at
   * all", costing the owner the entire scan and reporting it as "the scan has
   * not finished yet" — which describes the wrong problem.
   */
  rawResult: unknown;
}

/** Shared read + tenant scope for both job accessors. */
async function readAnalyzeWebsiteJob(
  jobId: string,
  organizationId?: string
): Promise<Result<AnalyzeWebsiteJobRecord>> {
  try {
    const redis = getRedis();
    // Bounded: an unhealthy Redis must fail this poll fast (the client treats
    // a poll failure as terminal) rather than hang the request while ioredis
    // queues the command during reconnects.
    const data = await withTimeout(redis.get(jobId), REDIS_OP_TIMEOUT_MS);
    if (!data) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Job not found or expired')
      );
    }
    const status = JSON.parse(data) as AnalyzeWebsiteJobStatus;
    const rawResult = status.result;
    // Same shape-drift guard as the analysis cache: a job written by the
    // previous deploy has the old result shape, so re-parse it through the
    // schema to backfill array fields the client iterates. An unparseable
    // result is dropped rather than handed over half-typed — but only from
    // THIS view; `rawResult` keeps it for the apply's lenient schema.
    if (status.result) {
      const revived = analyzeWebsiteResponseSchema.safeParse(status.result);
      status.result = revived.success ? revived.data : undefined;
    }
    // Tenant-scope: never expose another organization's job. Skipped when the
    // job was started without one (onboarding, before the org exists).
    if (status.organizationId && status.organizationId !== organizationId) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Job not found or expired')
      );
    }
    return ok({ status, rawResult });
  } catch {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to read job status')
    );
  }
}

/**
 * Get the status/result of a website analysis job.
 *
 * This is the POLL view, served to a client that iterates the result's arrays,
 * so a result that no longer parses is dropped rather than handed over
 * half-typed. Callers that intend to APPLY the scan want
 * {@link getAnalyzeWebsiteJobRecord} instead.
 */
export async function getAnalyzeWebsiteJob(
  jobId: string,
  organizationId?: string
): Promise<Result<AnalyzeWebsiteJobStatus>> {
  const record = await readAnalyzeWebsiteJob(jobId, organizationId);
  return record.success ? ok(record.data.status) : record;
}

/**
 * Get a job together with its result exactly as stored (see
 * {@link AnalyzeWebsiteJobRecord}). Same tenant scoping as the poll.
 */
export async function getAnalyzeWebsiteJobRecord(
  jobId: string,
  organizationId?: string
): Promise<Result<AnalyzeWebsiteJobRecord>> {
  return readAnalyzeWebsiteJob(jobId, organizationId);
}
