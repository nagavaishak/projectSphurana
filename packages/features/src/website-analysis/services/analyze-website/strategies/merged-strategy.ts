import { createLogger } from '@borradh-workspace/observability';

import { runBrowserbaseStrategy } from './browserbase-strategy.js';
import { runBrowserUseStrategy } from './browseruse-strategy.js';
import { runFirecrawlStrategy } from './firecrawl-strategy.js';
import {
  deduplicateServices,
  extractServicesFromContent,
  mergeServicesWithGpt,
} from './gpt-extract.js';
import { runOcrStrategy } from './ocr-strategy.js';
import type {
  ExtractedServiceData,
  MergedStrategyConfig,
  StrategyResult,
} from './types.js';

const logger = createLogger('MergedStrategy');

export interface MergedContentResult {
  /** Combined raw text content for the full AI analysis prompt */
  enrichedContent: string;
  /** Pre-extracted services from the merge pass (used to augment AI prompt) */
  mergedServices: ExtractedServiceData[];
  /** Which strategies actually contributed */
  strategiesUsed: string[];
}

// ─── E-Merged: Firecrawl + Browser Use + OCR → GPT-4o merge ─────────────

async function runEMergedStrategy(
  websiteUrl: string,
  config: MergedStrategyConfig
): Promise<MergedContentResult> {
  const strategiesUsed: string[] = [];
  const strategyResults: StrategyResult[] = [];

  // Per-source service buckets for the GPT merge prompt
  const firecrawlServices: ExtractedServiceData[] = [];
  const browserUseServices: ExtractedServiceData[] = [];
  let ocrServices: ExtractedServiceData[] = [];

  // --- Phase 1: Crawl in parallel (Firecrawl + Browser Use / Browserbase) ---

  const tasks: Array<{
    label: string;
    promise: Promise<StrategyResult | null>;
  }> = [];

  if (config.firecrawlApiKey) {
    tasks.push({
      label: 'firecrawl',
      promise: runFirecrawlStrategy(websiteUrl, config.firecrawlApiKey).catch(
        (error) => {
          logger.warn(
            `[e-merged] firecrawl failed: ${error instanceof Error ? error.message : String(error)}`
          );
          return null;
        }
      ),
    });
  }

  if (config.browserUseApiKey) {
    const buPromise = runBrowserUseStrategy(
      websiteUrl,
      config.browserUseApiKey
    ).catch((error) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn(`[e-merged] browser-use failed: ${msg}`);
      // Fallback to Browserbase on BU rate-limit / plan-limit errors
      if (
        (msg.includes('402') || msg.includes('429') || msg.includes('limit')) &&
        config.browserbaseApiKey &&
        config.browserbaseProjectId
      ) {
        logger.info('[e-merged] falling back to browserbase');
        return runBrowserbaseStrategy(websiteUrl, {
          // biome-ignore lint/style/noNonNullAssertion: guarded by the if above
          apiKey: config.browserbaseApiKey!,
          // biome-ignore lint/style/noNonNullAssertion: guarded by the if above
          projectId: config.browserbaseProjectId!,
        }).catch((bbErr) => {
          logger.warn(
            `[e-merged] browserbase fallback failed: ${bbErr instanceof Error ? bbErr.message : String(bbErr)}`
          );
          return null;
        });
      }
      return null;
    });
    tasks.push({ label: 'browser-use', promise: buPromise });
  } else if (config.browserbaseApiKey && config.browserbaseProjectId) {
    tasks.push({
      label: 'browserbase',
      promise: runBrowserbaseStrategy(websiteUrl, {
        apiKey: config.browserbaseApiKey,
        projectId: config.browserbaseProjectId,
      }).catch((error) => {
        logger.warn(
          `[e-merged] browserbase failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      }),
    });
  }

  const results = await Promise.allSettled(tasks.map((t) => t.promise));
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled' && r.value) {
      strategyResults.push(r.value);
      strategiesUsed.push(tasks[i].label);
    }
  }

  // --- Phase 2: Per-source GPT-4o extraction + OCR (all in parallel) ---

  const extractionTasks: Array<Promise<void>> = [];

  for (const result of strategyResults) {
    const isBrowserUse =
      result.source === 'browser-use' || result.source === 'browserbase';

    // Browser Use may return structured services directly
    if (isBrowserUse && result.services.length > 0) {
      browserUseServices.push(...result.services);

      // Only run GPT extraction on raw output when BU returned few structured
      // services (< 15) — suggests incomplete parse, worth a second look.
      // When BU already has 15+, the GPT call is redundant (~10-15s saved).
      if (
        result.services.length < 15 &&
        result.rawContent &&
        result.rawContent.length > 200
      ) {
        extractionTasks.push(
          extractServicesFromContent(result.rawContent, result.source).then(
            (services) => {
              browserUseServices.push(...services);
            }
          )
        );
      }
      continue;
    }

    if (result.rawContent && result.rawContent.length > 100) {
      const target = isBrowserUse ? 'browser-use' : 'firecrawl';
      extractionTasks.push(
        extractServicesFromContent(result.rawContent, result.source).then(
          (services) => {
            if (target === 'firecrawl') {
              firecrawlServices.push(...services);
            } else {
              browserUseServices.push(...services);
            }
          }
        )
      );
    }
  }

  // OCR on images discovered by any strategy
  const allImageUrls = [
    ...new Set(strategyResults.flatMap((r) => r.priceListImageUrls ?? [])),
  ].slice(0, 10);

  if (allImageUrls.length > 0) {
    extractionTasks.push(
      runOcrStrategy(allImageUrls)
        .then((ocrResult) => {
          if (ocrResult.services.length > 0) {
            ocrServices = ocrResult.services;
            strategiesUsed.push('ocr');
          }
        })
        .catch((error) => {
          logger.warn(
            `[e-merged] ocr failed: ${error instanceof Error ? error.message : String(error)}`
          );
        })
    );
  }

  await Promise.allSettled(extractionTasks);

  // --- Phase 3: GPT-4o merge all 3 sources ---

  const mergedServices = await mergeServicesWithGpt(
    firecrawlServices,
    browserUseServices,
    ocrServices
  );

  // Combine all raw content for brand voice / general context
  const enrichedContent = strategyResults
    .filter((r) => r.rawContent)
    .map((r) => r.rawContent ?? '')
    .join('\n\n')
    .slice(0, 120_000);

  logger.info(
    `[e-merged] complete — strategies: [${strategiesUsed.join(', ')}], ` +
      `fc: ${firecrawlServices.length}, bu: ${browserUseServices.length}, ocr: ${ocrServices.length}, ` +
      `merged: ${mergedServices.length}, ` +
      `content: ${enrichedContent.length} chars`
  );

  return {
    enrichedContent,
    mergedServices,
    strategiesUsed,
  };
}

// ─── Basic: Original raw-content-only approach ─────────────────────────────

async function runBasicStrategy(
  websiteUrl: string,
  config: MergedStrategyConfig
): Promise<MergedContentResult> {
  const strategiesUsed: string[] = [];
  const strategyResults: StrategyResult[] = [];

  const tasks: Promise<StrategyResult | null>[] = [];

  if (config.firecrawlApiKey) {
    tasks.push(
      runFirecrawlStrategy(websiteUrl, config.firecrawlApiKey).catch(
        (error) => {
          logger.warn(
            `[basic] firecrawl failed: ${error instanceof Error ? error.message : String(error)}`
          );
          return null;
        }
      )
    );
  }

  if (config.browserUseApiKey) {
    tasks.push(
      runBrowserUseStrategy(websiteUrl, config.browserUseApiKey).catch(
        (error) => {
          logger.warn(
            `[basic] browser-use failed: ${error instanceof Error ? error.message : String(error)}`
          );
          return null;
        }
      )
    );
  } else if (config.browserbaseApiKey && config.browserbaseProjectId) {
    tasks.push(
      runBrowserbaseStrategy(websiteUrl, {
        apiKey: config.browserbaseApiKey,
        projectId: config.browserbaseProjectId,
      }).catch((error) => {
        logger.warn(
          `[basic] browserbase failed: ${error instanceof Error ? error.message : String(error)}`
        );
        return null;
      })
    );
  }

  const results = await Promise.allSettled(tasks);
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value) {
      strategyResults.push(r.value);
      strategiesUsed.push(r.value.source);
    }
  }

  const priceListImages = [
    ...new Set(strategyResults.flatMap((r) => r.priceListImageUrls ?? [])),
  ].slice(0, 10);

  let ocrServices: ExtractedServiceData[] = [];
  if (priceListImages.length > 0) {
    try {
      const ocrResult = await runOcrStrategy(priceListImages);
      if (ocrResult.services.length > 0) {
        ocrServices = ocrResult.services;
        strategiesUsed.push('ocr');
      }
    } catch (error) {
      logger.warn(
        `[basic] ocr failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Browser Use returns structured services directly
  const browserUseServices = strategyResults
    .filter((r) => r.services.length > 0)
    .flatMap((r) => r.services);

  const mergedServices = deduplicateServices([
    ...ocrServices,
    ...browserUseServices,
  ]);

  const allRawContent = strategyResults
    .filter((r) => r.rawContent)
    .map((r) => r.rawContent ?? '')
    .join('\n\n');

  const enrichedContent = buildEnrichedContent(allRawContent, mergedServices);

  logger.info(
    `[basic] complete — strategies: [${strategiesUsed.join(', ')}], ` +
      `content: ${enrichedContent.length} chars, ` +
      `pre-extracted services: ${mergedServices.length}`
  );

  return {
    enrichedContent,
    mergedServices,
    strategiesUsed,
  };
}

function buildEnrichedContent(
  rawContent: string,
  services: ExtractedServiceData[]
): string {
  let content = rawContent;

  if (services.length > 0) {
    const section = services
      .map((s) => {
        const price = s.pricingDescription ? ` — ${s.pricingDescription}` : '';
        return `- ${s.name}${price}`;
      })
      .join('\n');

    content += `\n\n--- Pre-extracted services (OCR / Browser Use) ---\n${section}`;
  }

  return content;
}

// ─── Public entry point ────────────────────────────────────────────────────

export async function runMergedStrategy(
  websiteUrl: string,
  config: MergedStrategyConfig
): Promise<MergedContentResult> {
  const mode = config.mode ?? 'e-merged';

  if (mode === 'basic') {
    return runBasicStrategy(websiteUrl, config);
  }

  return runEMergedStrategy(websiteUrl, config);
}
