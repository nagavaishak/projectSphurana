import { chatCompletion } from '@borradh-workspace/ai';
import { createLogger } from '@borradh-workspace/observability';

import type { ExtractedServiceData } from './types.js';

const logger = createLogger('GptExtract');

const MAX_CONTENT_CHARS = 100_000;
const BATCH_SIZE_CHARS = 30_000;
const EXTRACTION_MODEL = 'gpt-4.1' as const;
const MERGE_MODEL = 'gpt-4.1' as const;

const EXTRACTION_PROMPT = `You are extracting services and pricing from a beauty/wellness/clinic business website.

RULES:
- Extract EVERY service mentioned with its exact name as written on the page
- Include ALL pricing details for each service (multiple tiers, areas, packages, durations)
- If pricing says "From" or "Starting at", preserve that prefix
- Do NOT invent services or prices — only extract what is explicitly stated
- Do NOT use placeholders like "Prices Vary" or "Contact for pricing" — omit pricingDescription if no price exists
- Include every price point, variant, duration, discount, and bundle shown
- Use EXACT service names — do not rephrase
- Each distinct variant (e.g. "Botox - 1 Area", "Botox - 2 Areas") should be its OWN entry

Return JSON: { "services": [{ "name": "exact name", "pricingDescription": "exact pricing" }] }
Return { "services": [] } if no services are found.`;

/**
 * Extract services from a single chunk of content.
 */
async function extractFromChunk(
  content: string,
  sourceLabel: string
): Promise<ExtractedServiceData[]> {
  if (!content || content.trim().length < 50) return [];

  try {
    const response = await chatCompletion(
      `${EXTRACTION_PROMPT}\n\n--- Website content (${sourceLabel}) ---\n${content}`,
      {
        model: EXTRACTION_MODEL,
        maxTokens: 8000,
        jsonResponse: true,
      }
    );

    if (!response.content) return [];

    const parsed = JSON.parse(response.content) as {
      services?: ExtractedServiceData[];
    };

    return (parsed.services ?? []).filter(
      (s) => s.name && s.name.trim().length > 0
    );
  } catch (error) {
    logger.warn(
      `[gpt-extract] ${sourceLabel} chunk extraction failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

/**
 * Extract services from content, splitting into batches for long content
 * so nothing is lost to truncation.
 */
export async function extractServicesFromContent(
  rawContent: string,
  sourceLabel: string
): Promise<ExtractedServiceData[]> {
  if (!rawContent || rawContent.trim().length < 50) return [];

  const truncated = rawContent.slice(0, MAX_CONTENT_CHARS);

  // Short content — single extraction call
  if (truncated.length <= BATCH_SIZE_CHARS) {
    const services = await extractFromChunk(truncated, sourceLabel);
    logger.info(
      `[gpt-extract] ${sourceLabel}: ${services.length} services extracted`
    );
    return services;
  }

  // Long content — split into batches at page boundaries (--- Page: ...) or by size
  const batches = splitIntoBatches(truncated, BATCH_SIZE_CHARS);
  logger.info(
    `[gpt-extract] ${sourceLabel}: splitting ${truncated.length} chars into ${batches.length} batches`
  );

  const results = await Promise.all(
    batches.map((batch, i) =>
      extractFromChunk(batch, `${sourceLabel} batch ${i + 1}/${batches.length}`)
    )
  );

  const all = results.flat();
  // Dedup across batches (same service may appear on multiple pages)
  const deduped = deduplicateServices(all);

  logger.info(
    `[gpt-extract] ${sourceLabel}: ${all.length} raw → ${deduped.length} deduplicated services`
  );

  return deduped;
}

/**
 * Split content into batches, preferring page boundaries (--- Page: ...).
 */
function splitIntoBatches(content: string, maxBatchSize: number): string[] {
  const PAGE_SEPARATOR = /\n---\s*Page:\s*/;
  const pages = content.split(PAGE_SEPARATOR);

  const batches: string[] = [];
  let current = '';

  for (const page of pages) {
    const pageWithHeader = current ? `\n--- Page: ${page}` : page;
    if (
      current.length + pageWithHeader.length > maxBatchSize &&
      current.length > 0
    ) {
      batches.push(current);
      current = `--- Page: ${page}`;
    } else {
      current += pageWithHeader;
    }
  }
  if (current.length > 0) batches.push(current);

  return batches;
}

// ---------------------------------------------------------------------------
// Merge
// ---------------------------------------------------------------------------

const MERGE_PROMPT = `You are consolidating raw service data from a beauty/wellness/clinic website. Three scrapers each found services independently — your job is to produce one complete master list.

CRITICAL RULES:
1. KEEP EVERY service from every source — do not drop anything unless it is a true duplicate of another entry
2. Two entries are a duplicate ONLY if they clearly refer to the exact same service AND same variant (e.g. "Botox 1 Area" and "Anti-Wrinkle Injections (Botox) 1 Area" are the same; "Lip Filler 0.5ml" and "Lip Filler 1ml" are NOT)
3. When two entries are the same service, merge them: use the most detailed name, richest pricingDescription
4. If one entry lists a SINGLE variant (e.g. "Botox - 1 Area: £160") and another lists MULTIPLE variants (e.g. "Botox: 1 Area £160, 2 Areas £200, 3 Areas £250"), keep the multi-variant entry — it is more complete
5. NEVER invent or infer prices not explicitly present in any source
6. If a source has pricing and another doesn't, use the pricing from the source that has it
7. Omit pricingDescription entirely if no price is present in ANY source
8. Return ONLY valid JSON:
{ "services": [{ "name": "Service Name", "pricingDescription": "£50 per session" }] }

SOURCE 1 — Firecrawl (full site crawl):
{SOURCE_FC}

SOURCE 2 — Browser Use (human-like navigation):
{SOURCE_BU}

SOURCE 3 — OCR (extracted from price list images):
{SOURCE_OCR}`;

const VERIFY_PROMPT = `You are reviewing a merged service list for a beauty/wellness/clinic business. Below is the merged list AND the raw service lists from each source.

Your job: find services that exist in ANY source but are MISSING from the merged list. Only return the missing ones.

RULES:
- A service is "missing" only if it appears in a source list but has NO match in the merged list (even under a different name)
- Do NOT add services that are already covered (even if named slightly differently)
- Do NOT invent services — only recover ones that were dropped during the merge
- If nothing is missing, return an empty array

Return JSON: { "missing": [{ "name": "exact name", "pricingDescription": "exact pricing" }] }

MERGED LIST:
{MERGED}

SOURCE 1 — Firecrawl:
{SOURCE_FC}

SOURCE 2 — Browser Use:
{SOURCE_BU}

SOURCE 3 — OCR:
{SOURCE_OCR}`;

function formatSourceServices(services: ExtractedServiceData[]): string {
  if (services.length === 0) return '(none found)';
  return services
    .map(
      (s) =>
        `- ${s.name}${s.pricingDescription ? `: ${s.pricingDescription}` : ''}`
    )
    .join('\n');
}

export async function mergeServicesWithGpt(
  firecrawlServices: ExtractedServiceData[],
  browserUseServices: ExtractedServiceData[],
  ocrServices: ExtractedServiceData[]
): Promise<ExtractedServiceData[]> {
  const total =
    firecrawlServices.length + browserUseServices.length + ocrServices.length;

  if (total === 0) return [];

  // If only one source has data, no merge needed — skip to verify pass
  const sources = [firecrawlServices, browserUseServices, ocrServices].filter(
    (s) => s.length > 0
  );
  if (sources.length === 1) return sources[0];

  const fcFormatted = formatSourceServices(firecrawlServices);
  const buFormatted = formatSourceServices(browserUseServices);
  const ocrFormatted = formatSourceServices(ocrServices);

  const prompt = MERGE_PROMPT.replace('{SOURCE_FC}', fcFormatted)
    .replace('{SOURCE_BU}', buFormatted)
    .replace('{SOURCE_OCR}', ocrFormatted);

  try {
    const response = await chatCompletion(prompt, {
      model: MERGE_MODEL,
      maxTokens: 16000,
      jsonResponse: true,
    });

    if (!response.content)
      return fallbackDedup(firecrawlServices, browserUseServices, ocrServices);

    const parsed = JSON.parse(response.content) as {
      services?: ExtractedServiceData[];
    };

    let services = (parsed.services ?? []).filter(
      (s) => s.name && s.name.trim().length > 0
    );

    logger.info(
      `[gpt-merge] merged ${total} raw → ${services.length} deduplicated services`
    );

    // --- Two-pass verification: catch stragglers dropped by the merge ---
    if (total > 10) {
      const recovered = await verifyMerge(
        services,
        fcFormatted,
        buFormatted,
        ocrFormatted
      );
      if (recovered.length > 0) {
        services = [...services, ...recovered];
        logger.info(
          `[gpt-verify] recovered ${recovered.length} missing services → total ${services.length}`
        );
      }
    }

    return services;
  } catch (error) {
    logger.warn(
      `[gpt-merge] merge failed, falling back to programmatic dedup: ${error instanceof Error ? error.message : String(error)}`
    );
    return fallbackDedup(firecrawlServices, browserUseServices, ocrServices);
  }
}

async function verifyMerge(
  mergedServices: ExtractedServiceData[],
  fcFormatted: string,
  buFormatted: string,
  ocrFormatted: string
): Promise<ExtractedServiceData[]> {
  try {
    const prompt = VERIFY_PROMPT.replace(
      '{MERGED}',
      formatSourceServices(mergedServices)
    )
      .replace('{SOURCE_FC}', fcFormatted)
      .replace('{SOURCE_BU}', buFormatted)
      .replace('{SOURCE_OCR}', ocrFormatted);

    const response = await chatCompletion(prompt, {
      model: MERGE_MODEL,
      maxTokens: 8000,
      jsonResponse: true,
    });

    if (!response.content) return [];

    const parsed = JSON.parse(response.content) as {
      missing?: ExtractedServiceData[];
    };

    return (parsed.missing ?? []).filter(
      (s) => s.name && s.name.trim().length > 0
    );
  } catch (error) {
    logger.warn(
      `[gpt-verify] verification pass failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return [];
  }
}

function fallbackDedup(
  ...groups: ExtractedServiceData[][]
): ExtractedServiceData[] {
  return deduplicateServices(groups.flat());
}

export function deduplicateServices(
  allServices: ExtractedServiceData[]
): ExtractedServiceData[] {
  const seen = new Map<string, ExtractedServiceData>();

  for (const svc of allServices) {
    const key = svc.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, svc);
    } else {
      const existingLen = existing.pricingDescription?.length ?? 0;
      const newLen = svc.pricingDescription?.length ?? 0;
      if (newLen > existingLen) {
        seen.set(key, svc);
      }
    }
  }

  return [...seen.values()];
}
