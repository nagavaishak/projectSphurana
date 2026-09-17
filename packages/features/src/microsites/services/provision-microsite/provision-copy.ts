/**
 * The ONE model call in provisioning, and the fallback that makes it optional.
 *
 * THE RULE: the LLM must not be able to break provisioning. A tenant with a
 * plain site beats a tenant with no site, so every failure mode of this module
 * — no API key, rate limit, malformed JSON, schema-invalid output, thrown
 * exception — returns `{ copy, source: 'fallback' }` derived from the org's
 * OWN data, and provisioning carries on to publish.
 *
 * `extractJson` (packages/ai/src/json-parser.ts) never throws and validates
 * against the Zod schema before it hands anything back, so model output is
 * already untrusted-input-shaped when it arrives here. It is validated a
 * SECOND time downstream, as part of the block schemas, before anything is
 * persisted.
 */

import {
  extractJson,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { createLogger } from '@borradh-workspace/observability';
import type { MicrositeOrgContext } from './provision-context.js';
import {
  type MicrositeCopy,
  micrositeCopySchema,
} from './provision-microsite.schema.js';

const logger = createLogger('ProvisionMicrosite');

/** Where the page copy came from. Surfaced so a caller can prompt for a rewrite. */
export type MicrositeCopySource = 'model' | 'fallback';

export interface MicrositeCopyResult {
  copy: MicrositeCopy;
  source: MicrositeCopySource;
  /** Populated on fallback so the reason is queryable, not just logged prose. */
  reason?: string;
}

const SYSTEM_MESSAGE = [
  'You write short, concrete website copy for local service businesses.',
  'Write in plain British English, second person, no marketing cliché, no emoji,',
  'no exclamation marks, and never invent facts (prices, awards, years in',
  'business, staff numbers) that were not given to you.',
  'Return ONLY JSON matching the requested keys.',
].join(' ');

export function buildCopyPrompt(context: MicrositeOrgContext): string {
  const services =
    context.serviceNames.length > 0
      ? context.serviceNames.join(', ')
      : 'not listed yet';

  return [
    `Business name: ${context.organizationName}`,
    context.city ? `Town/city: ${context.city}` : null,
    `Services offered: ${services}`,
    context.practitionerCount > 0
      ? `Team size: ${context.practitionerCount}`
      : null,
    '',
    "Write the copy for this business's new website as JSON with exactly these keys:",
    '  heroHeadline    — max 90 chars, the promise of the business',
    '  heroSubheadline — max 220 chars, one supporting sentence',
    '  aboutMarkdown   — max 2000 chars, 2-3 short paragraphs of markdown (no HTML, no headings above level 2)',
    '  servicesIntro   — max 400 chars, one or two sentences framing the service list',
    '  ctaHeadline     — max 90 chars, a booking call to action',
    '  ctaSubtext      — max 220 chars, one reassuring sentence',
    '  contactIntro    — max 400 chars, one or two sentences above the address and hours',
    '',
    'Do NOT list individual services, prices, staff names, opening hours or the',
    "address in any field — those are rendered live from the business's own",
    'records and would go stale if you repeated them.',
  ]
    .filter((line) => line !== null)
    .join('\n');
}

/**
 * Copy built from the org's own row. No model, no network, cannot fail.
 *
 * It is deliberately unremarkable: this is the floor, and the floor's job is
 * to be true and publishable, not clever.
 */
export function fallbackCopy(context: MicrositeOrgContext): MicrositeCopy {
  const name = context.organizationName;
  const where = context.city ? ` in ${context.city}` : '';
  const services = context.serviceNames.slice(0, 3);
  const serviceSentence =
    services.length > 0
      ? `We offer ${services.join(', ')} and more.`
      : 'Browse what we offer and book a time that suits you.';

  return {
    heroHeadline: `${name}`.slice(0, 90),
    heroSubheadline: `Book${where} online in a few taps.`.slice(0, 220),
    aboutMarkdown: [
      `## About ${name}`,
      '',
      `${name}${where} takes online bookings around the clock. ${serviceSentence}`,
      '',
      'Pick a time that suits you and we will confirm it straight away.',
    ]
      .join('\n')
      .slice(0, 2000),
    servicesIntro: 'Everything we offer, with up-to-date prices.'.slice(0, 400),
    ctaHeadline: 'Book your appointment'.slice(0, 90),
    ctaSubtext:
      `See live availability at ${name} and book in under a minute.`.slice(
        0,
        220
      ),
    contactIntro: `Find ${name}${where}, and see when we are open.`.slice(
      0,
      400
    ),
  };
}

/** Initialise the shared OpenAI client if a key is configured. */
const ensureAIClient = async (): Promise<boolean> => {
  if (isAIClientInitialized()) return true;
  const { apiEnv } = await import('@borradh-workspace/env/api');
  const apiKey = apiEnv.OPENAI_API_KEY;
  if (!apiKey) return false;
  initAIClient({ apiKey, defaultModel: 'gpt-4o' });
  return true;
};

const withFallback = (
  context: MicrositeOrgContext,
  reason: string
): MicrositeCopyResult => {
  logger.warn('Microsite copy generation fell back to org data', {
    event: 'microsites.copy_fallback',
    organizationId: context.organizationId,
    reason,
  });
  return { copy: fallbackCopy(context), source: 'fallback', reason };
};

export async function generateMicrositeCopy(
  context: MicrositeOrgContext
): Promise<MicrositeCopyResult> {
  try {
    if (!(await ensureAIClient())) {
      return withFallback(context, 'ai_client_unavailable');
    }

    const result = await extractJson<MicrositeCopy>(buildCopyPrompt(context), {
      systemMessage: SYSTEM_MESSAGE,
      schema: micrositeCopySchema,
      temperature: 0.6,
      /**
       * MANDATORY HERE. Provisioning runs in a BullMQ job, so there is no
       * ambient observability context to attribute the `$ai_generation` event
       * from — omit this and the org attribution is simply lost (see
       * .claude/rules/_patterns/ai-observability.md). `distinctId` is the org
       * id because this is a system call with no acting user.
       */
      observability: {
        distinctId: context.organizationId,
        spanName: 'microsites.provisionMicrosite',
        groups: { organization: context.organizationId },
      },
    });

    if (!result.success || !result.data) {
      logger.warn('Microsite copy model call did not yield usable JSON', {
        event: 'microsites.copy_extraction_failed',
        organizationId: context.organizationId,
        error: result.error,
        raw: result.raw?.slice(0, 500),
      });
      return withFallback(context, result.error ?? 'extraction_failed');
    }

    // `extractJson` already validated against the schema, but it validates
    // whatever schema-shaped object it was handed; re-parse so the trimming and
    // bounds are definitely applied to what we persist.
    const parsed = micrositeCopySchema.safeParse(result.data);
    if (!parsed.success) return withFallback(context, 'schema_revalidation');

    return { copy: parsed.data, source: 'model' };
  } catch (error) {
    // Nothing an LLM does may abort provisioning — not even an unexpected throw.
    return withFallback(
      context,
      error instanceof Error ? error.message : 'unknown_error'
    );
  }
}
