/**
 * Debug Content Service
 *
 * Fetches a URL using both plain fetch() and Playwright browser rendering,
 * then extracts structured data from each to show what each method "sees".
 * Used for the analysis split test page to compare extraction approaches.
 */

import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { getRedis } from '@borradh-workspace/redis';

import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { assertExternalUrl } from '../../utils/html.js';
import { SCRAPER_USER_AGENT } from '../../utils/user-agent.js';
import { extractTextFromHtml } from '../analyze-website/extract-html-metadata.js';
import {
  extractColorsFromHtml,
  extractLogoFromHtml,
} from '../analyze-website/extract-visual-assets.js';
import {
  type DebugContentInput,
  type DebugContentResponse,
  type ExtractedContent,
  type ExtractedService,
  type NavigationStep,
  debugContentSchema,
} from './debug-content.schema.js';

const logger = createLogger('DebugContent');

// ---------------------------------------------------------------------------
// Shared extraction helpers
// ---------------------------------------------------------------------------

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1]?.trim() ?? null;
}

function extractMetaDescription(html: string): string | null {
  const match = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
  );
  return match?.[1]?.trim() ?? null;
}

function extractOgTags(html: string): Record<string, string> {
  const tags: Record<string, string> = {};
  const regex =
    /<meta[^>]*property=["'](og:[^"']+)["'][^>]*content=["']([^"']+)["']/gi;
  for (let match = regex.exec(html); match !== null; match = regex.exec(html)) {
    if (match[1] && match[2]) {
      tags[match[1]] = match[2];
    }
  }
  return tags;
}

function extractSocialLinks(
  html: string
): Array<{ platform: string; url: string }> {
  const links: Array<{ platform: string; url: string }> = [];
  const seen = new Set<string>();

  const patterns: Array<{ platform: string; regex: RegExp }> = [
    {
      platform: 'facebook',
      regex: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s]+)["']/gi,
    },
    {
      platform: 'instagram',
      regex: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'\s]+)["']/gi,
    },
    {
      platform: 'twitter',
      regex:
        /href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s]+)["']/gi,
    },
    {
      platform: 'tiktok',
      regex: /href=["'](https?:\/\/(?:www\.)?tiktok\.com\/@[^"'\s]+)["']/gi,
    },
    {
      platform: 'youtube',
      regex: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/[^"'\s]+)["']/gi,
    },
    {
      platform: 'linkedin',
      regex: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/[^"'\s]+)["']/gi,
    },
  ];

  for (const { platform, regex } of patterns) {
    for (
      let match = regex.exec(html);
      match !== null;
      match = regex.exec(html)
    ) {
      const url = match[1];
      if (url && !seen.has(url)) {
        seen.add(url);
        links.push({ platform, url });
      }
    }
  }

  return links;
}

function extractFonts(html: string): string[] {
  const fonts = new Set<string>();

  // Google Fonts links
  const googleFontsRegex = /fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi;
  for (
    let match = googleFontsRegex.exec(html);
    match !== null;
    match = googleFontsRegex.exec(html)
  ) {
    if (match[1]) {
      const families = decodeURIComponent(match[1]).split('|');
      for (const f of families) {
        const name = f.split(':')[0]?.replace(/\+/g, ' ').trim();
        if (name) fonts.add(name);
      }
    }
  }

  // font-family declarations in CSS
  const fontFamilyRegex = /font-family:\s*["']?([^;"'}\n]+)/gi;
  for (
    let match = fontFamilyRegex.exec(html);
    match !== null;
    match = fontFamilyRegex.exec(html)
  ) {
    if (match[1]) {
      // Take the first font in the stack
      const first = match[1].split(',')[0]?.trim().replace(/["']/g, '');
      if (
        first &&
        first.length < 50 &&
        !first.includes('inherit') &&
        !first.includes('initial')
      ) {
        fonts.add(first);
      }
    }
  }

  return Array.from(fonts);
}

function extractBookingLinks(html: string): string[] {
  const links = new Set<string>();
  const bookingPatterns = [
    /href=["'](https?:\/\/[^"']*(?:fresha|phorest|treatwell|cliniko|jane\.app|acuityscheduling|calendly|aesthetidocs|booksy|vagaro|mindbody|square\.site)[^"']*)["']/gi,
    /href=["']([^"']*(?:book(?:ing)?|appointment|schedule|reserve)[^"']*)["']/gi,
  ];

  for (const pattern of bookingPatterns) {
    for (
      let match = pattern.exec(html);
      match !== null;
      match = pattern.exec(html)
    ) {
      if (match[1]) links.add(match[1]);
    }
  }

  return Array.from(links);
}

function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const regex =
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = regex.exec(html); match !== null; match = regex.exec(html)) {
    if (match[1]) {
      try {
        results.push(JSON.parse(match[1]));
      } catch {
        // skip malformed
      }
    }
  }
  return results;
}

function extractEmbeddedFrameworkData(html: string): unknown | null {
  // Livewire wire:snapshot data (contains full component state)
  const livewireData: unknown[] = [];
  const wireRegex = /wire:snapshot="([^"]+)"/g;
  for (
    let match = wireRegex.exec(html);
    match !== null;
    match = wireRegex.exec(html)
  ) {
    if (match[1]) {
      try {
        const decoded = match[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'");
        const parsed = JSON.parse(decoded);
        if (parsed?.data) livewireData.push(parsed.data);
      } catch {
        // skip
      }
    }
  }
  if (livewireData.length > 0)
    return { type: 'livewire', components: livewireData };

  // Next.js __NEXT_DATA__
  const nextMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextMatch?.[1]) {
    try {
      return { type: 'nextjs', data: JSON.parse(nextMatch[1]) };
    } catch {
      // skip
    }
  }

  // Nuxt __NUXT__
  const nuxtMatch = html.match(
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i
  );
  if (nuxtMatch?.[1]) {
    try {
      return { type: 'nuxt', data: JSON.parse(nuxtMatch[1]) };
    } catch {
      // skip
    }
  }

  return null;
}

/**
 * Extract services from structured data embedded in the HTML.
 * Supports: Livewire wire:snapshot (AesthetiDocs, etc.), JSON-LD Service schemas.
 */
function extractServicesFromHtml(
  html: string,
  embeddedData: unknown | null,
  jsonLd: unknown[]
): ExtractedService[] {
  const services: ExtractedService[] = [];
  const seen = new Set<string>();

  const addService = (s: ExtractedService) => {
    const key = `${s.category}::${s.name}`;
    if (seen.has(key)) return;
    seen.add(key);
    services.push(s);
  };

  // 1. Livewire wire:snapshot data — extract treatmentTypes from categories
  if (
    embeddedData &&
    typeof embeddedData === 'object' &&
    'type' in (embeddedData as Record<string, unknown>)
  ) {
    const ed = embeddedData as { type: string; components?: unknown[] };
    if (ed.type === 'livewire' && Array.isArray(ed.components)) {
      for (const component of ed.components) {
        extractLivewireTreatments(component, null, addService);
      }
    }
  }

  // 2. Also scan raw wire:snapshot attributes for treatment data
  // (in case embeddedData only captured top-level components)
  const wireRegex = /wire:snapshot="([^"]+)"/g;
  for (
    let match = wireRegex.exec(html);
    match !== null;
    match = wireRegex.exec(html)
  ) {
    if (match[1]) {
      try {
        const decoded = match[1]
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#39;/g, "'");
        const parsed = JSON.parse(decoded);
        if (parsed?.data) {
          extractLivewireTreatments(parsed.data, null, addService);
        }
      } catch {
        // skip
      }
    }
  }

  // 3. JSON-LD Service/Product/Offer schemas
  for (const ld of jsonLd) {
    extractJsonLdServices(ld, addService);
  }

  return services;
}

function extractLivewireTreatments(
  data: unknown,
  parentCategory: string | null,
  addService: (s: ExtractedService) => void
): void {
  if (!data || typeof data !== 'object') return;
  const obj = data as Record<string, unknown>;

  // Look for treatmentTypes array (direct)
  if (Array.isArray(obj.treatmentTypes)) {
    const categoryName = extractCategoryName(obj);
    for (const item of flattenLivewireArray(obj.treatmentTypes)) {
      if (typeof item === 'object' && item !== null) {
        const t = item as Record<string, unknown>;
        if (typeof t.name === 'string') {
          addService({
            name: t.name,
            category: categoryName || parentCategory,
            price: typeof t.price === 'number' ? t.price : null,
            duration: typeof t.duration === 'number' ? t.duration : null,
            deposit: typeof t.deposit === 'number' ? t.deposit : null,
            priceType: typeof t.priceType === 'string' ? t.priceType : null,
            description:
              typeof t.description === 'string' && t.description
                ? t.description
                : null,
          });
        }
      }
    }
  }

  // Look for treatmentTypesByCategories (array of category groups)
  if (Array.isArray(obj.treatmentTypesByCategories)) {
    for (const group of flattenLivewireArray(obj.treatmentTypesByCategories)) {
      if (typeof group === 'object' && group !== null) {
        extractLivewireTreatments(group, parentCategory, addService);
      }
    }
  }

  // Look for treatmentTypesByCategory (single category)
  if (Array.isArray(obj.treatmentTypesByCategory)) {
    for (const cat of flattenLivewireArray(obj.treatmentTypesByCategory)) {
      if (typeof cat === 'object' && cat !== null) {
        extractLivewireTreatments(cat, parentCategory, addService);
      }
    }
  }
}

/** Extract category name from a Livewire component data object */
function extractCategoryName(obj: Record<string, unknown>): string | null {
  // category can be [[{id, name, ...}, {s: "arr"}], {s: "arr"}] or {id, name}
  const cat = obj.category;
  if (Array.isArray(cat)) {
    for (const item of flattenLivewireArray(cat)) {
      if (
        typeof item === 'object' &&
        item !== null &&
        'name' in (item as Record<string, unknown>)
      ) {
        return (item as Record<string, unknown>).name as string;
      }
    }
  }
  if (
    typeof cat === 'object' &&
    cat !== null &&
    'name' in (cat as Record<string, unknown>)
  ) {
    return (cat as Record<string, unknown>).name as string;
  }
  return null;
}

/**
 * Livewire wraps arrays as [[item, {s:"arr"}], ...] — flatten them.
 */
function flattenLivewireArray(arr: unknown[]): unknown[] {
  const result: unknown[] = [];
  for (const item of arr) {
    if (Array.isArray(item)) {
      // Could be [actualObject, {s: "arr"}] or nested array
      for (const inner of item) {
        if (
          typeof inner === 'object' &&
          inner !== null &&
          !('s' in (inner as Record<string, unknown>))
        ) {
          result.push(inner);
        } else if (Array.isArray(inner)) {
          result.push(...flattenLivewireArray(inner));
        }
      }
    } else if (
      typeof item === 'object' &&
      item !== null &&
      !('s' in (item as Record<string, unknown>))
    ) {
      result.push(item);
    }
  }
  return result;
}

function extractJsonLdServices(
  ld: unknown,
  addService: (s: ExtractedService) => void
): void {
  if (!ld || typeof ld !== 'object') return;
  const obj = ld as Record<string, unknown>;

  // Handle @type: Service or Product
  const type = obj['@type'];
  if (type === 'Service' || type === 'Product') {
    const name = typeof obj.name === 'string' ? obj.name : null;
    if (name) {
      let price: number | null = null;
      if (obj.offers && typeof obj.offers === 'object') {
        const offers = obj.offers as Record<string, unknown>;
        if (typeof offers.price === 'number') price = offers.price;
        else if (typeof offers.price === 'string')
          price = Number.parseFloat(offers.price) || null;
      }
      addService({
        name,
        category: null,
        price,
        duration: null,
        deposit: null,
        priceType: null,
        description:
          typeof obj.description === 'string' ? obj.description : null,
      });
    }
  }

  // Handle @graph arrays
  if (Array.isArray(obj['@graph'])) {
    for (const item of obj['@graph']) {
      extractJsonLdServices(item, addService);
    }
  }

  // Handle hasOfferCatalog
  if (obj.hasOfferCatalog && typeof obj.hasOfferCatalog === 'object') {
    const catalog = obj.hasOfferCatalog as Record<string, unknown>;
    if (Array.isArray(catalog.itemListElement)) {
      for (const item of catalog.itemListElement) {
        extractJsonLdServices(item, addService);
      }
    }
  }
}

function extractFromHtml(
  html: string,
  baseUrl: string,
  durationMs: number
): ExtractedContent {
  const jsonLd = extractJsonLd(html);
  const embeddedData = extractEmbeddedFrameworkData(html);
  const services = extractServicesFromHtml(html, embeddedData, jsonLd);

  return {
    rawHtml: html.slice(0, 50_000),
    extractedText: extractTextFromHtml(html),
    title: extractTitle(html),
    metaDescription: extractMetaDescription(html),
    ogTags: extractOgTags(html),
    colors: extractColorsFromHtml(html),
    logoUrl: extractLogoFromHtml(html, baseUrl),
    socialLinks: extractSocialLinks(html),
    fonts: extractFonts(html),
    bookingLinks: extractBookingLinks(html),
    jsonLd,
    embeddedData,
    services,
    durationMs,
  };
}

// ---------------------------------------------------------------------------
// Browser-specific extraction (runs JS in page context)
// ---------------------------------------------------------------------------

// JS to evaluate inside browser context — serialized as a string to avoid
// TypeScript complaining about `document`/`window` in a Node environment.
const BROWSER_EXTRACT_SCRIPT = `(() => {
  const body = document.body;
  const computedStyle = window.getComputedStyle(body);
  const bodyFont = computedStyle.fontFamily;

  const colorSet = new Set();
  const elements = document.querySelectorAll(
    'header, nav, h1, h2, h3, a, button, [class*="brand"], [class*="primary"], [class*="accent"]'
  );
  for (const el of elements) {
    const style = window.getComputedStyle(el);
    const bg = style.backgroundColor;
    const color = style.color;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') colorSet.add(bg);
    if (color) colorSet.add(color);
  }

  const allLinks = [];
  document.querySelectorAll('a[href]').forEach((a) => {
    const href = a.href;
    if (href && href.startsWith('http')) allLinks.push(href);
  });

  // --- Extract services from the rendered DOM ---
  // Look for price patterns in the visible page text
  const priceRegex = /(?:€|\\$|£|\\bUSD|\\bEUR|\\bGBP)\\s*([\\d,.]+)|([\\d,.]+)\\s*(?:€|\\$|£)/;
  const durationRegex = /(\\d+)\\s*(?:min(?:ute)?s?|hrs?|hours?)/i;

  const services = [];
  const seenNames = new Set();

  // Strategy 1: Find list items / rows that contain both a name-like text and a price
  // Common patterns: li, tr, div with role=listitem, [data-*] containers
  const candidates = document.querySelectorAll(
    'li, tr, [role="listitem"], [role="option"], [role="button"], ' +
    '[class*="service"], [class*="treatment"], [class*="item"], [class*="menu-item"], ' +
    '[class*="Service"], [class*="Treatment"], [class*="Item"], [class*="MenuItem"], ' +
    '[class*="category"] > div, [class*="Category"] > div, ' +
    '[data-service], [data-treatment], [data-item]'
  );

  for (const el of candidates) {
    const text = (el.textContent || '').trim();
    if (!text || text.length > 500 || text.length < 3) continue;

    // Must have a price or duration indicator to look like a service
    const priceMatch = text.match(priceRegex);
    const durationMatch = text.match(durationRegex);

    if (!priceMatch && !durationMatch) continue;

    // Extract the "name" — typically the first meaningful text node or heading
    let name = '';
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [class*="name"], [class*="title"], [class*="Name"], [class*="Title"], strong, b');
    if (heading) {
      name = (heading.textContent || '').trim();
    }
    if (!name) {
      // Take text before the price
      const lines = text.split('\\n').map(l => l.trim()).filter(Boolean);
      name = lines[0] || '';
      // Strip price/duration from name
      name = name.replace(priceRegex, '').replace(durationRegex, '').replace(/[\\s-]+$/, '').trim();
    }

    if (!name || name.length < 2 || name.length > 100) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    const price = priceMatch ? parseFloat(priceMatch[1] || priceMatch[2]) : null;
    const duration = durationMatch ? parseInt(durationMatch[1], 10) : null;

    services.push({ name, price: isNaN(price) ? null : price, duration });
  }

  // Strategy 2: Look for accordion/collapsible category headers
  // and find services within expanded sections
  if (services.length === 0) {
    // Try broader search - any element with price-like content
    const allElements = document.querySelectorAll('div, span, p, td');
    const priceElements = [];
    for (const el of allElements) {
      // Only direct text (not nested element text)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join(' ');
      if (priceRegex.test(directText) && directText.length < 20) {
        priceElements.push(el);
      }
    }

    for (const priceEl of priceElements) {
      // Walk up to find the parent container
      const container = priceEl.closest('li, tr, div, article') || priceEl.parentElement;
      if (!container) continue;

      const text = (container.textContent || '').trim();
      const priceMatch = text.match(priceRegex);
      if (!priceMatch) continue;

      // Get name from sibling or parent text minus the price
      let name = text.replace(priceRegex, '').replace(durationRegex, '').trim();
      // Clean up leftover punctuation
      name = name.replace(/^[\\s\\-:]+|[\\s\\-:]+$/g, '').trim();

      if (!name || name.length < 2 || name.length > 100) continue;
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      const price = priceMatch ? parseFloat(priceMatch[1] || priceMatch[2]) : null;
      const durationMatch = text.match(durationRegex);
      const duration = durationMatch ? parseInt(durationMatch[1], 10) : null;

      services.push({ name, price: isNaN(price) ? null : price, duration });
    }
  }

  return {
    computedFont: bodyFont,
    computedColors: Array.from(colorSet).slice(0, 30),
    allLinks: allLinks.slice(0, 200),
    domServices: services.slice(0, 200),
  };
})()`;

async function extractWithBrowser(
  html: string,
  baseUrl: string,
  durationMs: number,
  page: { evaluate: (script: string) => Promise<unknown> }
): Promise<ExtractedContent> {
  // Start with the same HTML-based extraction
  const base = extractFromHtml(html, baseUrl, durationMs);

  // Enhance with browser-only data (computed styles)
  try {
    const browserData = (await page.evaluate(BROWSER_EXTRACT_SCRIPT)) as {
      computedFont: string;
      computedColors: string[];
      allLinks: string[];
      domServices: Array<{
        name: string;
        price: number | null;
        duration: number | null;
      }>;
    };

    // Merge computed font into fonts list
    if (browserData.computedFont) {
      const first = browserData.computedFont
        .split(',')[0]
        ?.trim()
        .replace(/["']/g, '');
      if (first && !base.fonts.includes(first)) {
        base.fonts.unshift(first);
      }
    }

    // Convert computed RGB colors to hex and merge
    for (const c of browserData.computedColors) {
      const rgbMatch = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (rgbMatch) {
        const r = Number.parseInt(rgbMatch[1], 10);
        const g = Number.parseInt(rgbMatch[2], 10);
        const b = Number.parseInt(rgbMatch[3], 10);
        // Skip near-black, near-white, grays
        if (r === g && g === b) continue;
        const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
        if (!base.colors.includes(hex)) {
          base.colors.push(hex);
        }
      }
    }

    // Merge DOM-extracted services (these come from the rendered page, not embedded data)
    if (browserData.domServices && browserData.domServices.length > 0) {
      const existingNames = new Set(
        base.services.map((s: ExtractedService) => s.name)
      );
      for (const ds of browserData.domServices) {
        if (!existingNames.has(ds.name)) {
          base.services.push({
            name: ds.name,
            category: null,
            price: ds.price,
            duration: ds.duration,
            deposit: null,
            priceType: null,
            description: null,
          });
          existingNames.add(ds.name);
        }
      }
      logger.info(
        `[debug-browser] extracted ${browserData.domServices.length} services from rendered DOM`
      );
    }
  } catch (error) {
    logger.warn(
      `[debug] browser evaluate failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return base;
}

// ---------------------------------------------------------------------------
// AI Navigation: page snapshot + LLM prompt
// ---------------------------------------------------------------------------

/** Extracts visible text and all clickable elements from the rendered page */
const SNAPSHOT_SCRIPT = `(() => {
  const visibleText = document.body.innerText.slice(0, 4000);

  const clickables = [];
  const seen = new Set();
  const els = document.querySelectorAll('a[href], button, [role="button"], [onclick]');

  for (const el of els) {
    const text = (el.textContent || '').trim().replace(/\\s+/g, ' ');
    if (!text || text.length > 100 || text.length < 2) continue;
    // Skip duplicates
    if (seen.has(text)) continue;
    seen.add(text);
    // Skip cookie/privacy/consent buttons
    if (/cookie|privacy|accept|consent|gdpr|customize|reject all|allow all|preferences|onetrust/i.test(text)) continue;

    const tag = el.tagName;
    const href = el.tagName === 'A' ? el.href : null;

    clickables.push({ index: clickables.length, tag, text, href });
    if (clickables.length >= 30) break;
  }

  return { visibleText, clickables };
})()`;

function buildNavigationPrompt(
  currentUrl: string,
  visibleText: string,
  clickables: Array<{
    index: number;
    tag: string;
    text: string;
    href: string | null;
  }>,
  stepNumber: number,
  previousSteps: NavigationStep[]
): string {
  const clickableList = clickables
    .map(
      (c) =>
        `  [${c.index}] <${c.tag.toLowerCase()}> "${c.text}"${c.href ? ` → ${c.href}` : ''}`
    )
    .join('\n');

  const history = previousSteps
    .map((s) => `- ${s.action} (${s.reasoning})`)
    .join('\n');

  return `You are navigating a beauty/wellness business website to find their booking system and extract their list of services (treatments, prices, etc.).

CURRENT URL: ${currentUrl}
STEP: ${stepNumber + 1}

PREVIOUS ACTIONS:
${history || '(none)'}

VISIBLE PAGE TEXT (truncated):
${visibleText}

CLICKABLE ELEMENTS:
${clickableList}

INSTRUCTIONS:
- Your PRIMARY goal is to reach the business's BOOKING SYSTEM — an external platform like Phorest, Fresha, Treatwell, Booksy, Cliniko, AesthetiDocs, etc. where customers actually book appointments. This is the most reliable source of services.
- Look for buttons or links like "Book Now", "Make an Appointment", "Book Online", "Reserve", etc. These typically link to an external booking platform.
- PRIORITIZE booking links over price list pages. A "Prices" or "Price List" page on the main website is useful but secondary — always try to reach the booking system first.
- Only respond with "done" when you are on a booking system page (different domain or booking platform URL) that shows service categories or a service list, OR if you have exhausted all booking links and are on the best available services page.
- If you see BOTH a "Book Now" link and a "Prices" link, ALWAYS click "Book Now" first.
- Do NOT click social media links, blog posts, "Sign In", "Log In", "My Account", or similar.

Respond with JSON: { "action": "click" | "done", "index": <number if clicking>, "reasoning": "<brief explanation>" }`;
}

// ---------------------------------------------------------------------------
// AI Service Consolidation (TODO: re-enable once split test is stable)
// ---------------------------------------------------------------------------

/* async function consolidateServicesWithAI(sources: {
  apiIntercepted: ExtractedService[];
  pricePageScraped: ExtractedService[];
  homepageExtracted: ExtractedService[];
}): Promise<ExtractedService[]> {
  // Cap each source to avoid token limits
  const capServices = (arr: ExtractedService[], max: number) => arr.slice(0, max);
  const sections: string[] = [];

  const api = capServices(sources.apiIntercepted, 150);
  const price = capServices(sources.pricePageScraped, 100);
  const home = capServices(sources.homepageExtracted, 50);

  if (api.length > 0) {
    sections.push(
      `BOOKING SYSTEM API (most reliable — structured data with exact prices):\n${api.map((s) => `- ${s.name} | category: ${s.category || '?'} | price: ${s.price ?? '?'} | duration: ${s.duration ?? '?'}min | deposit: ${s.deposit ?? '?'}`).join('\n')}`
    );
  }

  if (price.length > 0) {
    sections.push(
      `PRICE LIST PAGE (scraped from website — may have formatting issues):\n${price.map((s) => `- ${s.name} | price: ${s.price ?? '?'} | duration: ${s.duration ?? '?'}min`).join('\n')}`
    );
  }

  if (home.length > 0) {
    sections.push(
      `HOMEPAGE (lowest priority):\n${home.map((s) => `- ${s.name} | price: ${s.price ?? '?'}`).join('\n')}`
    );
  }

  const prompt = `You are consolidating service/treatment data from multiple sources for a beauty/wellness business. Each source has different reliability levels.

${sections.join('\n\n')}

RULES:
- The BOOKING SYSTEM API is the most reliable source. Use its service names, prices, and categories as the primary truth.
- The PRICE LIST PAGE may have useful services not in the booking system, or may have more detailed pricing. Include these but use their data as secondary.
- The HOMEPAGE is least reliable. Only use services from here if they don't appear in the other sources.
- Match and deduplicate services across sources. "Lip Fillers" and "Lip Filler" are the same service. "1 Area" under "BOTOX" and "BOTOX 1 Area" are the same.
- For price page scraped items: some may be VARIANTS of a service (e.g. "Full Body Inc Face £1,425" is a variant of "Laser Hair Removal"), not separate services. Group these under the correct parent service.
- Assign categories where possible. If the booking system has categories, use those. Otherwise infer from the service name.
- Keep the currency as-is from the source (don't convert).
- Return ALL real services, not a subset.

Return JSON: { "services": [{ "name": string, "category": string | null, "price": number | null, "duration": number | null, "deposit": number | null, "priceType": "fixed" | "from" | null, "description": string | null }] }`;

  const response = await chatCompletion(prompt, {
    maxTokens: 16000,
    jsonResponse: true,
  });

  if (!response.content) throw new Error('Empty AI response');

  const parsed = JSON.parse(response.content);
  const services = Array.isArray(parsed.services) ? parsed.services : [];

  return services
    .filter((s: Record<string, unknown>) => typeof s.name === 'string' && s.name.trim())
    .map((s: Record<string, unknown>) => ({
      name: String(s.name),
      category: typeof s.category === 'string' ? s.category : null,
      price: typeof s.price === 'number' ? s.price : null,
      duration: typeof s.duration === 'number' ? s.duration : null,
      deposit: typeof s.deposit === 'number' ? s.deposit : null,
      priceType: typeof s.priceType === 'string' ? s.priceType : null,
      description: typeof s.description === 'string' && s.description ? s.description : null,
    }));
} */

// ---------------------------------------------------------------------------
// Safe page.content() — retries if page is mid-navigation
// ---------------------------------------------------------------------------

async function safePageContent(page: {
  content: () => Promise<string>;
  waitForLoadState: (
    state?: 'domcontentloaded' | 'load' | 'networkidle',
    opts?: { timeout?: number }
  ) => Promise<void>;
  waitForTimeout: (ms: number) => Promise<void>;
}): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      return await page.content();
    } catch {
      logger.warn(
        `[debug-browser] page.content() failed (attempt ${attempt + 1}), waiting...`
      );
      await page.waitForTimeout(1500);
    }
  }
  // Last resort — return whatever we can get
  return await page.content();
}

// ---------------------------------------------------------------------------
// Main service
// ---------------------------------------------------------------------------

const debugContentImpl = async (
  input: DebugContentInput,
  apiKey?: string
): Promise<Result<DebugContentResponse>> => {
  const parsed = debugContentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { websiteUrl } = parsed.data;

  try {
    await assertExternalUrl(websiteUrl);
  } catch (error) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        error instanceof Error ? error.message : 'Invalid URL'
      )
    );
  }

  // Method 1: Plain fetch (what current system does)
  let fetchContent: ExtractedContent;
  try {
    const fetchStart = Date.now();
    const response = await fetch(websiteUrl, {
      headers: {
        'User-Agent': SCRAPER_USER_AGENT,
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      return err(
        new FeatureError(
          ErrorCodes.EXTERNAL_SERVICE_ERROR,
          `Fetch failed: HTTP ${response.status}`
        )
      );
    }
    const html = await response.text();
    const fetchDuration = Date.now() - fetchStart;
    fetchContent = extractFromHtml(html, websiteUrl, fetchDuration);
    // Trim heavy fields
    fetchContent.rawHtml = fetchContent.rawHtml.slice(0, 10_000);
    fetchContent.extractedText = fetchContent.extractedText.slice(0, 5_000);
  } catch (error) {
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        `Fetch failed: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  // Initialize AI client for navigation decisions
  if (apiKey && !isAIClientInitialized()) {
    initAIClient({ apiKey });
  }

  // Method 2: AI-driven browser navigation
  // An LLM reads each rendered page and decides what to click until it finds services.
  let browserContent: ExtractedContent | null = null;
  let browserError: string | null = null;
  const navigationLog: NavigationStep[] = [];

  try {
    const browserStart = Date.now();
    const pw = await import('playwright-core');
    const browser = await pw.chromium.launch({
      headless: true,
      args: ['--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox'],
    });

    try {
      const context = await browser.newContext({
        userAgent: SCRAPER_USER_AGENT,
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();

      // Block heavy resources for speed
      await page.route('**/*', (route) => {
        const type = route.request().resourceType();
        if (['image', 'media', 'font'].includes(type)) {
          return route.abort();
        }
        return route.continue();
      });

      // Intercept API responses that contain service/treatment data
      const interceptedServices: ExtractedService[] = [];
      const interceptedCategories = new Map<string, string>();

      page.on('response', (response) => {
        const respUrl = response.url();
        const contentType = response.headers()['content-type'] || '';
        if (!contentType.includes('json')) return;

        // Fire-and-forget — errors must not propagate
        void (async () => {
          try {
            if (
              /\/api\/service_categories|\/api\/categories|\/categories\b/i.test(
                respUrl
              )
            ) {
              const json = await response.json();
              const cats =
                json.service_categories ||
                json.categories ||
                json.data ||
                (Array.isArray(json) ? json : []);
              if (Array.isArray(cats)) {
                for (const cat of cats) {
                  if (cat.id && cat.name)
                    interceptedCategories.set(String(cat.id), String(cat.name));
                }
                logger.info(
                  `[debug-browser] intercepted ${interceptedCategories.size} categories from ${respUrl}`
                );
              }
            }
            if (
              /\/api\/services|\/api\/treatments|\/services\b|\/treatments\b/i.test(
                respUrl
              )
            ) {
              const json = await response.json();
              const svcs =
                json.services ||
                json.treatments ||
                json.data ||
                (Array.isArray(json) ? json : []);
              if (Array.isArray(svcs)) {
                for (const s of svcs) {
                  if (typeof s.name === 'string') {
                    const catId =
                      s.service_category_id || s.category_id || s.categoryId;
                    interceptedServices.push({
                      name: s.name,
                      category: catId
                        ? interceptedCategories.get(String(catId)) || null
                        : s.category_name || s.categoryName || null,
                      price: typeof s.price === 'number' ? s.price : null,
                      duration:
                        typeof s.duration === 'number' ? s.duration : null,
                      deposit: typeof s.deposit === 'number' ? s.deposit : null,
                      priceType: s.priced_from_disclaimer ? 'from' : null,
                      description:
                        typeof s.description === 'string' && s.description
                          ? s.description
                          : null,
                    });
                  }
                }
                logger.info(
                  `[debug-browser] intercepted ${interceptedServices.length} services from ${respUrl}`
                );
              }
            }
          } catch {
            // Response not readable
          }
        })();
      });

      // Navigate to homepage
      logger.info(`[debug-browser] rendering homepage: ${websiteUrl}`);
      await page.goto(websiteUrl, {
        waitUntil: 'networkidle',
        timeout: 20_000,
      });
      await page.waitForTimeout(1000);

      // Dismiss cookie banners before doing anything else
      try {
        await page.evaluate(`
          (() => {
            const dismissTexts = ['accept all', 'reject all', 'accept cookies', 'continue without', 'close', 'got it', 'i agree', 'ok'];
            const btns = document.querySelectorAll('button, a, [role="button"]');
            for (const btn of btns) {
              const text = (btn.textContent || '').trim().toLowerCase();
              if (dismissTexts.some(d => text.includes(d))) {
                btn.click();
                return true;
              }
            }
            // Also try common cookie banner close buttons
            const closeBtn = document.querySelector('.onetrust-close-btn-handler, [class*="cookie"] button, #cookie-close, .cookie-close');
            if (closeBtn) { closeBtn.click(); return true; }
            return false;
          })()
        `);
        await page.waitForTimeout(500);
      } catch {
        // Cookie dismissal is best-effort
      }

      // Wait for page to settle after any cookie banner interactions
      try {
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 });
      } catch {
        /* already loaded */
      }

      // Extract homepage data (colors, fonts, social links, etc.)
      const homepageHtml = await safePageContent(page);
      browserContent = await extractWithBrowser(
        homepageHtml,
        websiteUrl,
        Date.now() - browserStart,
        page
      );

      navigationLog.push({
        action: 'navigate',
        url: websiteUrl,
        reasoning: 'Initial page load',
      });

      // AI navigation loop
      let pricePageServices: ExtractedService[] = [];
      let reachedBookingSystem = false;
      const visitedUrls = new Set<string>([page.url()]);

      const MAX_STEPS = 6;
      for (let step = 0; step < MAX_STEPS; step++) {
        // Only stop if we reached a booking system and got services from it
        if (reachedBookingSystem && interceptedServices.length > 0) {
          logger.info(
            `[debug-browser] reached booking system with ${interceptedServices.length} API services, stopping`
          );
          break;
        }

        // Get a snapshot of the current page for the LLM
        const snapshot = await page.evaluate(SNAPSHOT_SCRIPT);
        const rawSnapshot = snapshot as {
          visibleText: string;
          clickables: Array<{
            index: number;
            tag: string;
            text: string;
            href: string | null;
          }>;
        };

        // Filter out clickables that link to already-visited URLs
        const filteredClickables = rawSnapshot.clickables
          .filter((c) => !c.href || !visitedUrls.has(c.href))
          .map((c, i) => ({ ...c, index: i })); // Re-index after filtering

        const pageSnapshot = {
          visibleText: rawSnapshot.visibleText,
          clickables: filteredClickables,
        };

        const prompt = buildNavigationPrompt(
          page.url(),
          pageSnapshot.visibleText,
          pageSnapshot.clickables,
          step,
          navigationLog
        );

        logger.info(
          `[debug-browser] step ${step + 1}: on ${page.url()}, asking LLM (${pageSnapshot.clickables.length} clickables: ${pageSnapshot.clickables
            .slice(0, 8)
            .map((c: { text: string }) => `"${c.text}"`)
            .join(', ')}...)`
        );

        const aiResponse = await chatCompletion(prompt, {
          maxTokens: 300,
          jsonResponse: true,
        });

        if (!aiResponse.content) {
          logger.warn('[debug-browser] empty LLM response, stopping');
          break;
        }

        let decision: { action: string; index?: number; reasoning: string };
        try {
          decision = JSON.parse(aiResponse.content);
        } catch {
          logger.warn(
            `[debug-browser] failed to parse LLM response: ${aiResponse.content}`
          );
          break;
        }

        logger.info(
          `[debug-browser] LLM decision: ${JSON.stringify(decision)}`
        );

        if (decision.action === 'done' || decision.action === 'stop') {
          navigationLog.push({
            action: 'stop',
            url: page.url(),
            reasoning: decision.reasoning,
          });
          break;
        }

        if (decision.action === 'click' && typeof decision.index === 'number') {
          const target = pageSnapshot.clickables[decision.index];
          if (!target) {
            logger.warn(
              `[debug-browser] invalid click index ${decision.index}`
            );
            break;
          }

          navigationLog.push({
            action: `click: "${target.text}"`,
            url: page.url(),
            reasoning: decision.reasoning,
          });

          try {
            // Click the element
            if (target.href) {
              logger.info(`[debug-browser] navigating to href: ${target.href}`);
              await page.goto(target.href, {
                waitUntil: 'networkidle',
                timeout: 20_000,
              });
            } else {
              // Button click — may trigger client-side navigation (SPAs)
              logger.info(`[debug-browser] clicking button: "${target.text}"`);
              const clickScript = `
                (() => {
                  const els = document.querySelectorAll('button, a, [role="button"], div[class*="button"], div[class*="Button"]');
                  for (const el of els) {
                    const text = (el.textContent || '').trim();
                    if (text === ${JSON.stringify(target.text)}) {
                      el.click();
                      return true;
                    }
                  }
                  return false;
                })()
              `;
              const clicked = await page.evaluate(clickScript);
              if (!clicked) {
                logger.warn(
                  `[debug-browser] could not find element to click: "${target.text}"`
                );
              }

              // Wait for SPA navigation or network activity
              await page.waitForTimeout(1500);
              try {
                await page.waitForLoadState('networkidle', { timeout: 10_000 });
              } catch {
                // May not fully settle — that's OK
              }
            }

            // Settle time for SPAs (React hydration, data fetching)
            await page.waitForTimeout(1500);

            // Dismiss cookie banners on new pages
            try {
              await page.evaluate(`
                (() => {
                  const dismiss = ['accept all', 'reject all', 'accept cookies', 'continue without', 'got it', 'i agree'];
                  for (const btn of document.querySelectorAll('button, a, [role="button"]')) {
                    const t = (btn.textContent || '').trim().toLowerCase();
                    if (dismiss.some(d => t.includes(d))) { btn.click(); return; }
                  }
                  const close = document.querySelector('.onetrust-close-btn-handler, [class*="cookie"] button');
                  if (close) close.click();
                })()
              `);
              await page.waitForTimeout(500);
            } catch {
              /* best effort */
            }

            // Loop detection — if we're back on a visited URL, skip
            const newUrl = page.url();
            if (visitedUrls.has(newUrl)) {
              logger.warn(
                `[debug-browser] already visited ${newUrl}, skipping`
              );
              continue;
            }
            visitedUrls.add(newUrl);

            // Check if we landed on a booking system
            const currentUrl = page.url();
            const bookingPlatforms = [
              'phorest',
              'fresha',
              'treatwell',
              'cliniko',
              'jane.app',
              'acuityscheduling',
              'aesthetidocs',
              'booksy',
              'vagaro',
              'mindbody',
              'square.site',
              'calendly',
            ];
            const isBookingSystem = bookingPlatforms.some((p) =>
              currentUrl.includes(p)
            );

            if (isBookingSystem) {
              reachedBookingSystem = true;
              logger.info(
                `[debug-browser] reached booking system: ${currentUrl}`
              );
            }

            // Re-extract from the new page
            const newHtml = await safePageContent(page);
            const newExtracted = extractFromHtml(newHtml, currentUrl, 0);

            // Also run browser extraction for DOM-rendered services
            const enhanced = await extractWithBrowser(
              newHtml,
              currentUrl,
              0,
              page
            );

            // Collect all services from this page
            const pageServices: ExtractedService[] = [];
            const seenOnPage = new Set<string>();
            for (const s of [...newExtracted.services, ...enhanced.services]) {
              if (!seenOnPage.has(s.name)) {
                pageServices.push(s);
                seenOnPage.add(s.name);
              }
            }

            if (isBookingSystem) {
              // Booking system services are primary — they'll be merged at the end
              // (interceptedServices from API responses are even better)
              logger.info(
                `[debug-browser] booking system page has ${pageServices.length} DOM services`
              );
            } else if (pageServices.length > 0) {
              // Price page services — keep the largest set as fallback
              if (pageServices.length > pricePageServices.length) {
                pricePageServices = pageServices;
                logger.info(
                  `[debug-browser] price page has ${pageServices.length} services (saved as fallback, replaces previous ${pricePageServices.length})`
                );
              } else {
                logger.info(
                  `[debug-browser] price page has ${pageServices.length} services (keeping previous ${pricePageServices.length})`
                );
              }
            }

            if (newExtracted.embeddedData && !browserContent.embeddedData) {
              browserContent.embeddedData = newExtracted.embeddedData;
            }
          } catch (clickError) {
            logger.warn(
              `[debug-browser] click failed: ${clickError instanceof Error ? clickError.message : String(clickError)}`
            );
          }
        }
      }

      // Step: LLM extraction on the rendered booking page text (always runs)
      let llmServices: ExtractedService[] = [];
      if (apiKey) {
        try {
          // Use innerText for cleaner visible text (vs extractTextFromHtml which strips tags from raw HTML)
          const visibleText = (
            ((await page.evaluate('document.body.innerText')) as string) || ''
          ).slice(0, 50000);

          if (visibleText.length > 200) {
            logger.info(
              `[debug-browser] running LLM extraction on ${visibleText.length} chars of rendered text`
            );
            const llmResponse = await chatCompletion(
              `Extract ALL services/treatments from this booking page text. This is a beauty/wellness business.

PAGE TEXT:
${visibleText}

Return JSON: { "services": [{ "name": string, "category": string | null, "price": number | null, "currency": string | null, "duration": number | null, "description": string | null }] }

Rules:
- Include EVERY service listed, not just a subset
- Use exact service names as shown
- "Price varies" means price is null
- Duration like "1 hr" = 60, "45 min" = 45, "1 hr 30 min" = 90
- Group into categories if the page shows category headings
- Currency should be the symbol used (e.g. "CA$", "£", "€", "$")`,
              {
                maxTokens: 16000,
                jsonResponse: true,
              }
            );

            if (llmResponse.content) {
              try {
                const parsed = JSON.parse(llmResponse.content);
                if (Array.isArray(parsed.services)) {
                  llmServices = parsed.services
                    .filter(
                      (s: Record<string, unknown>) =>
                        typeof s.name === 'string' && s.name.trim()
                    )
                    .map((s: Record<string, unknown>) => ({
                      name: String(s.name),
                      category:
                        typeof s.category === 'string' ? s.category : null,
                      price: typeof s.price === 'number' ? s.price : null,
                      duration:
                        typeof s.duration === 'number' ? s.duration : null,
                      deposit: null,
                      priceType: s.price === null ? 'varies' : 'fixed',
                      description:
                        typeof s.description === 'string' && s.description
                          ? s.description
                          : null,
                    }));
                  logger.info(
                    `[debug-browser] LLM extracted ${llmServices.length} services`
                  );
                }
              } catch {
                logger.warn('[debug-browser] LLM response JSON parse failed');
              }
            }
          }
        } catch (llmError) {
          logger.warn(
            `[debug-browser] LLM extraction failed: ${llmError instanceof Error ? llmError.message : String(llmError)}`
          );
        }
      }

      // Merge all sources: API (highest trust) + LLM extraction + DOM scraping + price page
      logger.info(
        `[debug-browser] merging: ${interceptedServices.length} API + ${llmServices.length} LLM + ${pricePageServices.length} price page + ${browserContent.services.length} DOM`
      );

      const mergedServices: ExtractedService[] = [];
      const seenNames = new Set<string>();

      /** Normalize a service name for dedup — strips price/duration junk appended by DOM scraper */
      const normalizeName = (name: string) =>
        name
          .replace(/Price varies.*$/i, '')
          .replace(/CA\s*\$[\d.,]+.*$/i, '')
          .replace(/[£€$][\d.,]+.*$/i, '')
          .replace(/\d+\s*min\+?.*$/i, '')
          .replace(/\d+\s*hr.*$/i, '')
          .replace(/[・・\-]+\s*$/g, '')
          .replace(/\s+/g, ' ')
          .trim()
          .toLowerCase();

      const addServices = (services: ExtractedService[]) => {
        for (const s of services) {
          const key = normalizeName(s.name);
          if (!key || seenNames.has(key)) continue;
          seenNames.add(key);
          mergedServices.push(s);
        }
      };

      // Priority order: API > LLM > price page > DOM scraping
      addServices(interceptedServices);
      addServices(llmServices);
      addServices(pricePageServices);
      addServices(browserContent.services);

      browserContent.services = mergedServices;
      logger.info(
        `[debug-browser] final: ${browserContent.services.length} services`
      );

      browserContent.durationMs = Date.now() - browserStart;

      // Trim heavy fields to keep response size reasonable
      browserContent.rawHtml = browserContent.rawHtml.slice(0, 10_000);
      browserContent.extractedText = browserContent.extractedText.slice(
        0,
        5_000
      );
      // Truncate embedded data if massive (Livewire snapshots can be huge)
      if (browserContent.embeddedData) {
        const edStr = JSON.stringify(browserContent.embeddedData);
        if (edStr.length > 50_000) {
          browserContent.embeddedData = {
            _truncated: true,
            sizeBytes: edStr.length,
          };
        }
      }

      logger.info(
        `[debug-browser] done: ${browserContent.services.length} services, ${browserContent.durationMs}ms`
      );

      await context.close();
      logger.info('[debug-browser] context closed');
    } finally {
      await browser.close();
      logger.info('[debug-browser] browser closed');
    }
  } catch (error) {
    browserError = error instanceof Error ? error.message : String(error);
    logger.error(`[debug] browser method failed: ${browserError}`);
  }

  logger.info(
    `[debug] building response: browserServices=${browserContent?.services.length ?? 0}, navSteps=${navigationLog.length}`
  );

  const response: DebugContentResponse = {
    url: websiteUrl,
    fetchMethod: fetchContent,
    browserMethod: browserContent,
    browserError,
    navigationLog,
  };

  // Sanity check response size
  try {
    const responseSize = JSON.stringify(response).length;
    logger.info(
      `[debug] response JSON size: ${(responseSize / 1024).toFixed(1)} KB`
    );
  } catch (serErr) {
    logger.error(
      `[debug] response serialization failed: ${serErr instanceof Error ? serErr.message : String(serErr)}`
    );
  }

  return ok(response);
};

export const debugContent = (input: DebugContentInput, apiKey?: string) =>
  trackedResult(
    'website-analysis.debugContent',
    () => debugContentImpl(input, apiKey),
    {
      properties: { websiteUrl: input.websiteUrl },
    }
  );

export type DebugContentResult = Awaited<ReturnType<typeof debugContent>>;

// ---------------------------------------------------------------------------
// Async job-based API (start + poll)
// ---------------------------------------------------------------------------

const JOB_PREFIX = 'debug-job';
const JOB_TTL = 300; // 5 minutes

export interface DebugContentJobStatus {
  status: 'pending' | 'done' | 'error';
  /** Organization that owns this job — used to enforce tenant-scoped polling. */
  organizationId: string;
  result?: DebugContentResponse;
  error?: string;
}

/**
 * Start a debug content analysis as a background job.
 * Returns a jobId immediately; poll getDebugContentJob() for the result.
 */
export async function startDebugContentJob(
  input: DebugContentInput,
  organizationId: string,
  apiKey?: string
): Promise<Result<{ jobId: string }>> {
  const parsed = debugContentSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const jobId = `${JOB_PREFIX}:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Store initial pending status
  try {
    const redis = getRedis();
    await redis.set(
      jobId,
      JSON.stringify({ status: 'pending', organizationId }),
      'EX',
      JOB_TTL
    );
  } catch {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to create job')
    );
  }

  // Run in background — don't await
  void (async () => {
    try {
      const result = await debugContentImpl(input, apiKey);
      const redis = getRedis();
      if (result.success) {
        await redis.set(
          jobId,
          JSON.stringify({
            status: 'done',
            organizationId,
            result: result.data,
          }),
          'EX',
          JOB_TTL
        );
      } else {
        await redis.set(
          jobId,
          JSON.stringify({
            status: 'error',
            organizationId,
            error: result.error.message,
          }),
          'EX',
          JOB_TTL
        );
      }
    } catch (error) {
      try {
        const redis = getRedis();
        await redis.set(
          jobId,
          JSON.stringify({
            status: 'error',
            organizationId,
            error: error instanceof Error ? error.message : 'Unknown error',
          }),
          'EX',
          JOB_TTL
        );
      } catch {
        // Redis unavailable
      }
      logger.error(
        `[debug-job] ${jobId} failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  })();

  return ok({ jobId });
}

/**
 * Get the status/result of a debug content job.
 */
export async function getDebugContentJob(
  jobId: string,
  organizationId: string
): Promise<Result<DebugContentJobStatus>> {
  try {
    const redis = getRedis();
    const data = await redis.get(jobId);
    if (!data) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Job not found or expired')
      );
    }
    const status = JSON.parse(data) as DebugContentJobStatus;
    // Tenant-scope: never expose another organization's job.
    if (status.organizationId !== organizationId) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Job not found or expired')
      );
    }
    return ok(status);
  } catch {
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to read job status')
    );
  }
}
