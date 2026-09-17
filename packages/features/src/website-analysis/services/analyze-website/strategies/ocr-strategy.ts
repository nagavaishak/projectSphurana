import { visionCompletion } from '@borradh-workspace/ai';
import type { ImageInput } from '@borradh-workspace/ai';
import { createLogger } from '@borradh-workspace/observability';

import type { ExtractedServiceData, StrategyResult } from './types.js';

const logger = createLogger('OcrStrategy');

const MAX_IMAGES = 10;

export async function runOcrStrategy(
  imageUrls: string[]
): Promise<StrategyResult> {
  if (imageUrls.length === 0) {
    return { services: [], source: 'ocr' };
  }

  // Images arrive pre-filtered from firecrawl (only from pages with price keywords).
  // Skip only URLs that are obviously NOT price lists.
  const SKIP_PATTERN =
    /logo|icon|favicon|banner[-_]?img|hero[-_]?img|social|avatar|profile[-_]?pic|team[-_]?photo|staff[-_]?photo|thumbnail|badge|bg[-_]|background[-_]?img|slide|carousel|gallery[-_]?img|before[-_]?after|testimonial[-_]?img|review[-_]?img/i;

  const candidates = imageUrls
    .filter((url) => !SKIP_PATTERN.test(url))
    .slice(0, MAX_IMAGES);

  if (candidates.length === 0) {
    return { services: [], source: 'ocr' };
  }

  logger.info(`[ocr] scanning ${candidates.length} images for price lists`);

  const images: ImageInput[] = candidates.map((url) => ({ url }));

  const prompt = `You are analyzing images from a beauty/wellness clinic website. Some of these images may contain price lists, treatment menus, or service cards with pricing.

RULES:
- ONLY extract services and prices that are clearly visible as TEXT in the images
- Do NOT hallucinate or infer services — only extract what you can literally read
- If an image does not contain a price list or service menu, return an empty array for it
- Skip images that are decorative photos, team photos, hero banners, product shots, or anything that is NOT a price list
- Use the EXACT service names and prices as printed

For each service found, provide:
- "name": exact service name as written
- "pricingDescription": exact pricing text as written (include all price tiers, durations, etc.)

Return JSON: { "services": [{ "name": "...", "pricingDescription": "..." }] }
Return { "services": [] } if no price lists are found in any image.`;

  try {
    const response = await visionCompletion(prompt, images, {
      maxTokens: 4000,
      detail: 'high',
      jsonResponse: true,
    });

    if (!response.content) {
      return { services: [], source: 'ocr' };
    }

    const parsed = JSON.parse(response.content) as {
      services?: ExtractedServiceData[];
    };

    const services = (parsed.services ?? []).filter(
      (s) => s.name && s.name.trim().length > 0
    );

    logger.info(`[ocr] extracted ${services.length} services from images`);

    return { services, source: 'ocr' };
  } catch (error) {
    logger.warn(
      `[ocr] vision extraction failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return { services: [], source: 'ocr' };
  }
}
