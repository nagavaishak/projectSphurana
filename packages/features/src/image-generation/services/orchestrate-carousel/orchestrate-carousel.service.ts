/**
 * `orchestrateCarousel` — generate a coherent multi-slide carousel.
 *
 * Plan-up-front + shared-style + parallel (the agreed coherence model):
 *   1. ONE Claude planning call lays out the whole post — a narrative arc
 *      (hook → points → CTA), distinct per-slide copy, no repeats.
 *   2. We resolve ONE shared STYLE reference SET (a small coherent group of the
 *      org's own past posts) up front and pass it to EVERY slide, so the whole
 *      deck is built against the same visual system. The font image is shared
 *      too, so type stays locked across slides.
 *   3. Slides generate in PARALLEL via `generateBrandedGraphic`, each with its
 *      planned copy as a slide directive but the same brand/style/font inputs.
 *
 * Coherence comes from the shared plan + shared reference + shared font/colour
 * — not from serial generation, so it's fast.
 *
 * Returns ordered slide PNGs; the caller (worker) uploads each as one slide of
 * the graphic's output strip.
 */

import { createAnthropicClient } from '@borradh-workspace/ai';
import { organization, organizationService } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import { recordProvenanceSafe } from '../../../content-provenance/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  OFF_DECK_GROUND_DISTANCE,
  colourDistance,
  readBrandPalette,
  readGroundColour,
} from '../../brand-swatch.js';
import {
  briefWithTopic,
  resolveDeckBrief,
} from '../../carousel-templates/index.js';
import type { ImageryPolicy } from '../../imagery-policy.js';
import { ensureLogoVariants } from '../../logo-variants.js';
import { resolveReferenceImageUrl } from '../../resolve-reference-image-urls.js';
import { generateBrandedGraphic } from '../generate-branded-graphic/index.js';
import { resolveSlotImage } from '../resolve-slot-image/index.js';
import { selectInspirationSet } from '../select-inspiration-set/index.js';
import {
  type OrchestrateCarouselInput,
  orchestrateCarouselSchema,
} from './orchestrate-carousel.schema.js';

/** Keep the first N references; `undefined` or 0 means keep them all. */
const capReferences = (urls: string[], max?: number): string[] =>
  max && max > 0 ? urls.slice(0, max) : urls;

const PLAN_MODEL = 'claude-sonnet-4-6';

const log = createLogger('OrchestrateCarousel');

interface PlannedSlide {
  role: string; // 'hook' | 'point' | 'cta' | ...
  heading: string;
  body: string;
}

export interface CarouselSlideOutput {
  slideOrder: number;
  png: Buffer;
  width: number;
  height: number;
  role: string;
  /**
   * The photograph this slide used, so the worker's corrective re-render can
   * pin it instead of re-resolving and stealing a neighbour's. See
   * `consumedAssetId` on the render result.
   */
  consumedAssetId?: string;
  /**
   * The words this slide was planned to carry, for the same reason
   * `consumedAssetId` is here: a corrective re-render must pin them.
   *
   * Without it the worker's `rerender` sent the DECK's topic — "explain the
   * powder brow healing timeline slide by slide" — as the topic for one slide,
   * with no copy at all. A correction aimed at a logo could therefore rewrite
   * the slide's words, and if the prior image failed to load (a case the
   * renderer warns about and continues through) the re-render had nothing left
   * but that deck topic to build from.
   */
  copy?: { heading: string; body: string };
}

export interface OrchestrateCarouselOutput {
  slides: CarouselSlideOutput[];
  model: string;
  /**
   * The deck's copy as one readable block, persisted onto the graphic row.
   *
   * Singles have always stored this; carousels never did, so the words a
   * carousel actually shows existed nowhere queryable. That is why an owner
   * quoting a line off one of their own slides could not be matched to the
   * graphic showing it — the only text we held was `topicSummary`, which is
   * what we asked the model FOR, not what it produced.
   */
  renderedCopy: string;
}

/**
 * Cap on concurrent slide generations. Each slide is a paid Gemini image
 * call; firing a whole carousel at once (bare Promise.all) multiplied by the
 * worker's job concurrency stampeded the model into 429 storms. 2-at-a-time
 * keeps carousels fast while shaping request rate. (Mirrors the file-local
 * `mapLimit` in build-brand-corpus — deliberately not a new dependency.)
 */
/**
 * Build each slide by EDITING the cover, instead of generating it against the
 * cover. Off by default; `CAROUSEL_EDIT_SLIDES=1` turns it on.
 *
 * The case for editing: a generation re-decides the background every time, an
 * edit reproduces pixels it can see. Measured on two decks through the real
 * pipeline, every one of eight edited slides landed within 9 of its cover,
 * against a generate arm whose cover drifted off the deck entirely.
 *
 * THE REFERENCE IS FIXED, NOT ROLLING, and that is the whole design.
 *
 * The first version edited the slide IMMEDIATELY BEFORE, which reproduces its
 * predecessor's mistakes as faithfully as its intentions. An edit holds a
 * ground approximately, not exactly, so each step adds a little error and the
 * chain makes it permanent. Measured, deck by deck: consecutive slides moved
 * 1.4, 1.1, 9.1, 0.6 — one slide reproduced the ground a shade deeper
 * (#9f727b → #a0646b, green and blue both down ~14) and every slide after it
 * inherited the new value. On another deck the same mechanism ran 12 → 18 → 24
 * → 30, climbing monotonically away from the cover.
 *
 * Editing the COVER every time keeps the operation and removes the
 * propagation: a slide that wobbles is one slide, not a new baseline.
 *
 * The cost is CONCURRENCY. Every slide still waits for the cover, but they no
 * longer wait for each other, so this is only one render deep rather than
 * fully serial.
 */
const EDIT_SLIDES = process.env.CAROUSEL_EDIT_SLIDES === '1';

const SLIDE_GENERATION_CONCURRENCY = 2;

/**
 * Should a failed slide be re-sent with photography switched off?
 *
 * Exported so the rule is testable without standing up a whole deck render —
 * the behaviour it encodes cost four full recomposes in production and is worth
 * pinning on its own.
 *
 * ONLY a content refusal, and only once: identical inputs are refused
 * deterministically, so the retry has to change something, and `text-led` is
 * the one change that removes the thing being refused. A deck already rendering
 * text-led has nothing left to drop.
 */
/**
 * A deck must survive a bad slide.
 *
 * Both assembly loops used to be `if (!r.success) return err(...)`, with the
 * comment "a partial carousel is not useful". Production disagreed: ONE slide
 * refused on content safety discarded six finished slides, and because the job
 * then retried the whole deck it did so four times over — ~28 image calls, no
 * output, and an error message telling the owner to try again.
 *
 * Six slides is a publishable carousel. Zero is not. The trade is obviously
 * worth making, and the only real question is where the floor sits.
 *
 * THE COVER IS NON-NEGOTIABLE. It is the deck's anchor image — every other
 * slide is rendered against it — and it is the only slide most people see. A
 * deck missing its cover is not a shorter deck, it is a different one.
 */
export const MIN_VIABLE_SLIDES = 3;

/**
 * How many off-deck slides one deck will re-roll for colour, and how many
 * attempts each gets.
 *
 * Both numbers come from a sweep of eleven brands (55 slides). Ten slides left
 * the deck; nine were re-rolled and seven of those corrections stuck. The two
 * that shipped wrong failed for reasons the first version of this code caused,
 * not for want of a diagnosis:
 *
 *  - one deck had THREE off-deck slides against a cap of two, so the third was
 *    never attempted;
 *  - two retries came back WORSE, were correctly discarded, and then had no
 *    second attempt — so the bad slide shipped unchanged.
 *
 * Hence three slides and two attempts each. The cap is not about "most slides
 * drifting is a different problem" (the original reasoning): a deck with three
 * bad slides is not a different problem, it is the same problem three times,
 * and it is the deck that most needs fixing.
 */
const MAX_COLOUR_REROLLS = 3;
const COLOUR_REROLL_ATTEMPTS = 2;

export function isDeckViable(
  renderedSlideOrders: number[],
  minViable: number = MIN_VIABLE_SLIDES
): boolean {
  return (
    renderedSlideOrders.includes(0) && renderedSlideOrders.length >= minViable
  );
}

export function shouldRetryWithoutImagery(
  errorCode: string | undefined,
  policy: ImageryPolicy | undefined
): boolean {
  return errorCode === ErrorCodes.AI_MODEL_REFUSED && policy !== 'text-led';
}

// NOTE: the retry itself now lives in `generateBrandedGraphic`, not here. It was
// written in this file first, and the very next run went down the OTHER carousel
// route and dropped four slides the retry would have saved. Every render has to
// be covered, so it belongs at the one point they all pass through. This
// predicate is retained as the statement of the rule.

/**
 * Resolve the deck's photo pool ONCE, so no two slides show the same picture.
 *
 * Slides render in parallel, so a slide resolving its own asset cannot know
 * what its neighbours took. `claimRotatedAsset` serialises the claim, but the
 * pools here are tiny — two to five usable assets is typical — and a refusal
 * retry re-resolves, so collisions are the norm rather than the exception. A
 * deck that shows the same photograph on slides 3 and 4 is not a near miss; it
 * reads as a mistake to anyone who scrolls it.
 *
 * Shared by both carousel routes. It lived only in the template path, and when
 * briefs moved organic decks onto the corpus path they silently lost it — the
 * same shape of regression as the missing `suppressLogo`. A deck-level
 * behaviour has to live somewhere both routes reach.
 */
async function resolveDeckAssetPool(
  db: DbConnection,
  args: {
    organizationId: string;
    serviceId: string;
    graphicId?: string;
    topic: string;
    sourceAssetIds?: string[];
    allowStockImages?: boolean;
    imageryPolicy?: ImageryPolicy;
  }
): Promise<string[] | undefined> {
  // An explicit selection is an instruction, not a default — respect its order.
  if (args.sourceAssetIds?.length) return args.sourceAssetIds;

  const probe = await resolveSlotImage(db, {
    organizationId: args.organizationId,
    targetServiceId: args.serviceId,
    prompt: args.topic,
    bbox: { w: 1080, h: 1350 },
    allowAiImages: false,
    allowStockImages: args.allowStockImages,
    policy: args.imageryPolicy,
  });
  if (!probe.success || !probe.data.candidateAssetIds?.length) return undefined;

  log.info('Carousel photo pool resolved', {
    organizationId: args.organizationId,
    graphicId: args.graphicId,
    pool: probe.data.candidateAssetIds.length,
    // 1 means repetition is unavoidable and no rotation helps — a content
    // problem, not a selection one. Worth seeing rather than inferring it from
    // five identical slides.
    rotationPoolSize: probe.data.rotationPoolSize,
  });
  return probe.data.candidateAssetIds;
}

/** Per-slide imagery arguments drawn from a deck-wide pool. */
export function slideImageryArgs(
  deckAssetIds: string[] | undefined,
  i: number
): {
  sourceAssetIds: string[] | undefined;
  excludeAssetIds: string[] | undefined;
  preferStockImage: boolean;
  slotRotationSalt: string;
} {
  const mine =
    deckAssetIds && i < deckAssetIds.length ? [deckAssetIds[i]] : undefined;
  return {
    // Slides WITHIN the pool take one of its assets each; slides beyond it take
    // a stock still, salted by slide index so they differ from each other.
    sourceAssetIds: mine,
    /**
     * EVERY OTHER SLIDE'S ASSET, so a re-resolve cannot steal one.
     *
     * Assigning one asset per slide is not enough on its own: a content refusal
     * re-resolves the slot, and the retry knows only what THIS slide was told.
     * Without the rest of the deck named here it would fall back to the service
     * pool and could pick the photograph slide 2 is already using — putting the
     * duplicate back by the exact route the up-front assignment closed.
     *
     * Naming them means a refused slide reaches for stock or nothing, which is
     * the honest outcome: the deck has no other photograph to give it.
     */
    excludeAssetIds: deckAssetIds?.filter((id) => id !== mine?.[0]),
    preferStockImage: Boolean(deckAssetIds && i >= deckAssetIds.length),
    slotRotationSalt: String(i),
  };
}

/** Concurrency-bounded async map (order-preserving). */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const idx = cursor++;
        out[idx] = await fn(items[idx], idx);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) throw new Error('No JSON in model reply');
  const open = candidate[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === open) depth++;
    else if (candidate[i] === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)) as T;
    }
  }
  throw new Error('Unbalanced JSON in model reply');
}

/** Optional user-instruction block appended to a carousel copy-planner message. */
function carouselRefinementBlock(refinementInstruction?: string): string {
  return refinementInstruction?.trim()
    ? `\n\nThe user reviewed the previous version and asked for this change — apply it across the whole deck while still following each slide's spec: ${refinementInstruction.trim()}`
    : '';
}

async function planSlides(
  businessName: string,
  serviceName: string,
  serviceDescription: string | null,
  topic: string,
  slideCount: number,
  refinementInstruction?: string
): Promise<PlannedSlide[]> {
  const client = createAnthropicClient();
  const system = `You plan a cohesive Instagram carousel for a service business. Return ONLY a JSON array of exactly ${slideCount} slides forming a single coherent narrative (slide 1 = scroll-stopping hook, middle slides = one distinct point each, final slide = call-to-action). No repeated points. Keep copy tight and on-brand for a social graphic.

The BUSINESS and the SERVICE are different things. Refer to the business by its own name; never call the business by the service's name.

NEVER write: a customer name, a quotation attributed to a customer, a star rating or review score, a statistic or percentage you cannot source from what you were told, a price, a before/after results claim, or an instruction to "swipe", "tap", "vote", "comment below" or visit a "link in bio". A graphic is read on its own — an instruction to swipe is interface chrome, not copy. If a slide seems to call for one of those, write around it.
Each slide:
{ "role": "hook" | "point" | "cta", "heading": "short punchy heading", "body": "1-2 short sentences of body copy" }

THE FIRST SLIDE IS A POSTER, NOT A PARAGRAPH. Slide 1 gets a headline and NOTHING ELSE — return an EMPTY string for its body, or at most a six-word kicker. It is seen at thumbnail size in a feed and has one job: make someone stop. A cover carrying a headline AND a body paragraph has no dominant element, because it was given two things to be dominant.

LENGTH IS A HARD CONSTRAINT, not a preference. A heading is at most 8 words. A body is at most 30 words, across at most two sentences. A LIMIT IS NOT A LICENCE TO TRUNCATE: every heading must be a complete thought that ends where it means to. Under the cap, "Myth: Your Skin Will Break Out After" is not a shorter headline, it is an unfinished one — write a shorter COMPLETE line instead. These are read at a glance on a phone, beside a photograph, and copy that overruns is set smaller and smaller until the slide is a paragraph — one deck came back with a twelve-line body ragged against its picture. If the point will not fit, cut it down; do not carry it over.`;
  const message = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 1500,
    system,
    messages: [
      {
        role: 'user',
        content: `Business: ${businessName}\nService: ${serviceName}${serviceDescription ? ` — ${serviceDescription}` : ''}\nTopic of the post: ${topic}${carouselRefinementBlock(refinementInstruction)}\n\nReturn the ${slideCount}-slide JSON array.`,
      },
    ],
  });
  const text = message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');
  const slides = extractJson<PlannedSlide[]>(text);
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error('planner returned no slides');
  }
  return slides.slice(0, slideCount);
}

/**
 * THE DECK'S GROUND IS A DECK FACT, NOT WHATEVER SLIDE 1 HAPPENED TO BE.
 *
 * Removing composition templates removed the DECLARATION of a ground, not the
 * existence of one. Nothing tells the planner or the renderer what colour a
 * deck sits on, so slide 1 invents it and every later slide inherits an
 * accident. Two decks for the same org, same code, same run: one drew a flat
 * mauve cover and its slides held within 5 of it; the other drew a full-bleed
 * photograph, leaving nothing to inherit, and its slides walked 12 → 18 → 24 →
 * 30 away from it.
 *
 * The fix is NOT to ban full-bleed covers. A deck should be free to bleed a
 * photograph to all four edges — that is a composition choice, and a good one.
 * What it must not do is let that choice decide the deck's colour. So the
 * ground is resolved once, up front, as an actual colour, and stated to every
 * slide separately from anything about layout.
 *
 * Sources, in order of how much they know about the brand. Coverage across the
 * 101 production orgs is in the comment on each:
 */
async function resolveDeckGround(args: {
  styleReferenceUrls?: string[];
  fontImageUrl: string | null;
}): Promise<{ colour: string; source: string } | null> {
  // 1. THE BRAND'S OWN POSTS — 64 orgs. The set is already chosen for
  //    consistency, so its ground is the brand's ground.
  if (args.styleReferenceUrls?.length) {
    const images = (
      await Promise.all(
        args.styleReferenceUrls.slice(0, 3).map(async (stored) => {
          try {
            const url = await resolveReferenceImageUrl(stored);
            const res = await fetch(url);
            return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
          } catch {
            return null;
          }
        })
      )
    ).filter((b): b is Buffer => b !== null);
    const palette = await readBrandPalette(images);
    if (palette) return { colour: palette.ground, source: 'brand-corpus' };
  }

  // 2. THE "FONT REFERENCE" — 2 of the 37 orgs with no corpus. The file is
  //    usually a finished brand post rather than a type specimen, which is a
  //    defect when the model copies its CONTENT and an asset when we read its
  //    colour. See the type-specimen note in generate-branded-graphic.
  if (args.fontImageUrl) {
    try {
      const url = await resolveReferenceImageUrl(args.fontImageUrl);
      const res = await fetch(url);
      if (res.ok) {
        const palette = await readBrandPalette([
          Buffer.from(await res.arrayBuffer()),
        ]);
        if (palette)
          return { colour: palette.ground, source: 'font-reference' };
      }
    } catch {
      // Best effort; the cover fallback below still applies.
    }
  }

  // 3. Nothing derivable — 26 orgs. `primaryColor` is deliberately NOT used
  //    here: 35 of 101 orgs sit on one of three defaults (#7c3aed, #000000,
  //    #7a00df), so for a third of the estate it names a colour nobody chose.
  //    Those decks fall back to reading the cover once it exists, which is
  //    today's behaviour and no worse.
  return null;
}

const orchestrateCarouselImpl = async (
  db: DbConnection,
  input: OrchestrateCarouselInput
): Promise<Result<OrchestrateCarouselOutput>> => {
  const parsed = orchestrateCarouselSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    serviceId,
    topic,
    slideCount,
    model,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    imageryPolicy,
    suppressBrandReferences,
    maxBrandReferences,
    refinementInstruction,
    graphicId,
  } = parsed.data;

  const [svc] = await db
    .select({
      name: organizationService.name,
      description: organizationService.description,
    })
    .from(organizationService)
    .where(eq(organizationService.id, serviceId))
    .limit(1);
  // THE BUSINESS NAME, which the copy planner was never given.
  //
  // It only ever saw `Service: Embody Slim`, so it wrote "book with Embody
  // Slim" and "from open to close at Embody Slim" — presenting a SERVICE as the
  // business. The gate caught it as `wrong-brand-name` on three graphics in one
  // batch and two of them shipped anyway.
  const [org] = await db
    .select({
      name: organization.name,
      // A brand post more often than a type specimen — see the note on the
      // deck ground below.
      fontImageUrl: organization.brandFontImageUrl,
    })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (!svc) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }

  // Resolve BOTH logo polarities ONCE and share them across every slide. Each
  // slide then picks the polarity that contrasts with its own background. One
  // resolution → no per-slide fetch flakiness, and the inverted copy is minted
  // + cached in S3 a single time.
  const logoVariants = await ensureLogoVariants(db, organizationId);

  /**
   * THE BRIEF REPLACES THE TEMPLATE FOR ORGANIC.
   *
   * A curated template carries two things: an editorial SHAPE (a myth
   * countdown, a day in the life) and a COMPOSITION SPEC. The shape is worth
   * keeping and the spec is what produces the defects — every one left in the
   * audit was something a template asked for in words, and a production batch
   * returned two of them verbatim once the screenshot was already suppressed.
   *
   * A semantic brief keeps the shape and drops the spec: it says what the post
   * is ABOUT and nothing about how it looks. Composition then comes from the
   * brand's own posts, which is where it came from anyway whenever the two
   * disagreed.
   *
   * The brief also carries the month's planned topic, which template selection
   * silently discarded — it hashed the graphic id while the planner chose the
   * topic independently, and the template's `copySpec` won.
   *
   * Falling through to the corpus path is the whole implementation: that path
   * already plans its own narrative and sends no `layoutPrompt`, which is the
   * configuration the local harness has been rendering all along.
   */
  /**
   * WHICH SHAPE THIS DECK TAKES.
   *
   * There is one source now. Composition templates used to sit alongside briefs
   * and lose: a selected brief superseded a pinned template, so the curated
   * layouts, their per-slide grounds and their photo suppression never reached
   * a production organic deck while still reading, in the code and in the app's
   * picker, as if they did. They are gone; see
   * docs/plans/graphic-generation-state-of-play.md §0.
   *
   * `templateSlug` survives as the PIN because that is what the app sends and
   * what `graphic.template_slug` holds. `resolveDeckBrief` accepts either a
   * brief slug or the composition slug a brief took over from, so rows written
   * before briefs had identities still reproduce the deck they made.
   */
  const deckBrief = resolveDeckBrief(
    parsed.data.templateSlug ?? undefined,
    graphicId ?? serviceId
  );
  const briefedTopic = briefWithTopic(deckBrief.brief, topic);
  log.info('Carousel brief resolved', {
    organizationId,
    graphicId,
    brief: deckBrief.slug,
    pinned: Boolean(parsed.data.templateSlug),
  });

  // 1. Plan the post.
  let planned: PlannedSlide[];
  try {
    planned = await planSlides(
      org?.name ?? 'this business',
      svc.name,
      svc.description,
      // The brief when there is one, so the deck's SHAPE comes from it and the
      // month's topic still reaches the planner (see `briefWithTopic`).
      briefedTopic,
      slideCount,
      refinementInstruction
    );
  } catch (error) {
    logError('imageGeneration.orchestrateCarousel.plan', error, {
      feature: 'image-generation',
      extra: { organizationId, serviceId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to plan the carousel.'
      )
    );
  }

  // 2. Resolve the shared reference SET up front. Every slide gets the same
  //    images, which is what pins one visual system across the deck — a slide
  //    resolving its own reference is how a set ends up looking like five
  //    unrelated posts.
  let sharedStyleUrls: string[] | undefined;
  let referenceColourway: string | undefined;
  let referenceLogoMatchFallback: boolean | undefined;
  const set = suppressBrandReferences
    ? null
    : await selectInspirationSet(db, { organizationId });
  if (set?.success && set.data.urls.length > 0) {
    sharedStyleUrls = capReferences(set.data.urls, maxBrandReferences);
    referenceColourway = set.data.colourway ?? undefined;
    referenceLogoMatchFallback = set.data.logoMatchFallback;
    log.info('Carousel reference set resolved', {
      organizationId,
      graphicId,
      references: set.data.urls.length,
      colourway: set.data.colourway,
      // Below ~0.5 the org has no consistent visual system, and no reference
      // set will make its decks look like one brand. Worth seeing.
      consistencyScore: Number(set.data.consistencyScore.toFixed(2)),
      logoMatchFallback: set.data.logoMatchFallback,
    });
  }

  // 3. Generate slides in bounded parallel — shared brand/style/font,
  // distinct copy, and ONE photograph each. Concurrency is capped to shape
  // Gemini request rate.
  const deckAssetIds = await resolveDeckAssetPool(db, {
    organizationId,
    serviceId,
    graphicId,
    topic,
    sourceAssetIds,
    allowStockImages,
    imageryPolicy,
  });
  const total = planned.length;
  /**
   * THE COVER RENDERS FIRST AND BECOMES THE SPEC FOR THE REST.
   *
   * This path had no anchor at all. Slides fanned out in parallel with nothing
   * to match, and a deck came back four slides on the brand's pink ground and
   * one on cream — the exact failure the anchor was built for. The template
   * route has done this since it was written; when briefs moved organic decks
   * here they lost it, alongside `suppressLogo` and the deck asset pool.
   *
   * Three deck-level behaviours, all living in only one of two routes. The
   * lesson is structural rather than incidental: anything that makes a deck a
   * DECK has to sit where both paths reach it, or the next path to be added
   * loses it too.
   *
   * Costs one extra wave of latency; slides 2..n still render in parallel.
   */
  /**
   * Read at CALL time, not capture time: it is resolved before the cover
   * renders, and the cover fallback fills it in before the rest fan out.
   */
  let deckGroundColour: string | undefined;

  const renderPlannedSlide = (
    slide: PlannedSlide,
    i: number,
    anchor?: { data: string; mediaType: string },
    /**
     * The finished slide immediately before this one. When present the slide is
     * built as an EDIT of it rather than generated against the cover, so the
     * anchor is withheld — two references to a deck's look is one more than the
     * model can satisfy, and it resolves that by recomposing.
     */
    editBase?: { data: string; mediaType: string }
  ) =>
    generateBrandedGraphic(db, {
      organizationId,
      serviceId,
      graphicId,
      slideIndex: i,
      provenanceOperation: 'compose',
      topic: `${slide.heading} — ${slide.body}`,
      model,
      brandPrimaryColor,
      allowAiImages,
      ...slideImageryArgs(deckAssetIds, i),
      allowStockImages,
      imageryPolicy,
      // Not forwarded: the renderer takes references as URLs, and
      // `sharedStyleUrls` is already empty when they are suppressed.
      styleReferenceUrls: sharedStyleUrls,
      referenceColourway,
      referenceLogoMatchFallback,
      logoLightBase64: logoVariants.light?.data,
      logoLightMediaType: logoVariants.light?.mediaType,
      logoDarkBase64: logoVariants.dark?.data,
      logoDarkMediaType: logoVariants.dark?.mediaType,
      slideDirective: `This is slide ${i + 1} of ${total} in ONE carousel (role: ${slide.role}). Keep the SAME layout, fonts, colours and visual treatment as the other slides so the set looks like one coherent post.`,
      renderCopy: { heading: slide.heading, body: slide.body },
      refinementInstruction,
      // Part of a multi-slide set → deck-wide typography lock + shared footer.
      isCarouselSlide: true,
      /**
       * ONLY THE COVER CARRIES THE MARK.
       *
       * The template path set this per slide from `showLogo`; this path never
       * set it at all, which did not matter while templates were the only
       * organic route. Briefs made this the organic route, and every slide
       * came back branded — so the quality gate flagged `logo-present` on
       * every non-cover slide and burned a corrective re-render on each one.
       * Five extra image calls per deck to undo something the request should
       * not have asked for.
       *
       * The rest of a deck is deliberately unbranded: their missing logo is
       * the design, and its presence is the defect.
       */
      suppressLogo: i !== 0,
      deckAnchorBase64: editBase ? undefined : anchor?.data,
      deckAnchorMediaType: editBase ? undefined : anchor?.mediaType,
      priorImageBase64: editBase?.data,
      /**
       * SENT TO EVERY SLIDE, INCLUDING EDITED ONES — and that was tested.
       *
       * The obvious theory was that an edited slide has the deck's colour as
       * PIXELS already, so the hex is a second, weaker answer it splits the
       * difference with. The evidence for it looked strong: across four decks,
       * spread tracked how far the cover had landed from the declared ground
       * (1.3 → 1.8, 1.7 → 6.3, 5.2 → 7.2, 13.0 → 16.1).
       *
       * Withholding it from edited slides made one deck better and one much
       * worse — a high-tension deck went 16.1 → 8.2, a low-tension one went
       * 7.2 → 29.6, its grounds scattering from five near-identical creams to
       * #cfbdb8 / #b9bbb5 / #ddc6ba / #918f83 / #d8e0d6. Slides given only the
       * cover did NOT simply reproduce it.
       *
       * So the text is not merely a competing signal, it is an anchor: it holds
       * slides together when the copy is imperfect, which is most of the time.
       * With it, spreads were 1.8 / 6.3 / 7.2 / 16.1; without, 8.2 / 29.6.
       */
      deckGroundColour,
      priorImageMediaType: editBase?.mediaType,
      regenerationIntent: editBase ? ('sibling' as const) : undefined,
    }).then((r) => ({ r, slide, i }));

  /**
   * Resolved BEFORE the cover so the cover is bound by it too — the cover is a
   * slide of this deck, not the thing that defines it.
   */
  const resolvedGround = await resolveDeckGround({
    styleReferenceUrls: sharedStyleUrls,
    fontImageUrl: org?.fontImageUrl ?? null,
  });
  if (resolvedGround) {
    log.info('Deck ground resolved', {
      organizationId,
      graphicId,
      ground: resolvedGround.colour,
      source: resolvedGround.source,
    });
  }
  deckGroundColour = resolvedGround?.colour;

  /**
   * THE PLAN IS THE ONE UPSTREAM DECISION WITH NO RECORD.
   *
   * Everything downstream is provenanced per slide — which asset, which
   * references, which layout signal, which logo outcome — and the call that
   * decides what all six slides SAY produced nothing at all. So a deck could be
   * read back slide by slide without ever recovering what it was asked to be,
   * and a question as basic as "did the plan tell slide 1 to be a before/after"
   * had no answer in the system.
   *
   * Recorded here rather than at the plan call so the ground and the reference
   * set are known: those three together are the deck's whole identity, and
   * splitting them across rows means reassembling them by timestamp later.
   *
   * The copy is stored verbatim. It is the text that will be rendered, so it is
   * neither secret nor large, and paraphrasing it would defeat the purpose —
   * the question is usually whether a specific word in the plan produced a
   * specific thing in the picture.
   */
  await recordProvenanceSafe(db, {
    organizationId,
    subjectType: 'graphic',
    subjectId: graphicId ?? `ungrouped-${Date.now()}`,
    serviceId,
    mediaSource: 'none',
    logoOutcome: 'not-applicable',
    templateSlug: deckBrief.slug,
    detail: {
      operation: 'carousel-plan',
      brief: deckBrief.slug,
      briefProse: deckBrief.brief,
      pinned: Boolean(parsed.data.templateSlug),
      topic,
      slideCount,
      // What the deck was told to sit on, and where that came from.
      deckGroundColour: deckGroundColour ?? null,
      deckGroundSource: resolvedGround?.source ?? null,
      // Which of the brand's own posts taught this deck its look.
      referenceKeys: sharedStyleUrls ?? [],
      referenceColourway: referenceColourway ?? null,
      editChain: EDIT_SLIDES,
      // The plan itself, slide by slide.
      plan: planned.map((sl, i) => ({
        slideIndex: i,
        role: sl.role,
        heading: sl.heading,
        body: sl.body,
      })),
    },
  });
  log.info('Carousel plan recorded', {
    organizationId,
    graphicId,
    brief: deckBrief.slug,
    slideCount,
    deckGroundColour: deckGroundColour ?? null,
    headings: planned.map((sl) => sl.heading),
  });

  const cover = await renderPlannedSlide(planned[0], 0);
  if (!cover.r.success) {
    return err(cover.r.error) as Result<OrchestrateCarouselOutput>;
  }
  const anchor = {
    data: cover.r.data.png.toString('base64'),
    mediaType: 'image/png',
  };
  if (!deckGroundColour) {
    // Nothing about the brand named a ground, so the cover's is the deck's —
    // which is what happened implicitly before, except now it is stated to
    // every slide as a colour instead of being inferred from an image.
    deckGroundColour = (await readGroundColour(cover.r.data.png)) ?? undefined;
    if (deckGroundColour) {
      log.info('Deck ground taken from the cover', {
        organizationId,
        graphicId,
        ground: deckGroundColour,
      });
    }
  }
  // Editing the cover keeps the slides independent of each other, so they can
  // still fan out concurrently — only the cover is a barrier.
  const rest = await mapLimit(
    planned.slice(1),
    SLIDE_GENERATION_CONCURRENCY,
    (slide, n) =>
      renderPlannedSlide(slide, n + 1, anchor, EDIT_SLIDES ? anchor : undefined)
  );
  const results = [cover, ...rest];

  const slides: CarouselSlideOutput[] = [];
  let usedModel = model ?? 'gemini-3-pro-image';
  const droppedCorpus: { slideIndex: number; role: string; code: string }[] =
    [];
  for (const { r, slide, i } of results) {
    if (!r.success) {
      // Drop it and keep going — see `isDeckViable`.
      droppedCorpus.push({
        slideIndex: i,
        role: slide.role,
        code: r.error.code,
      });
      continue;
    }
    usedModel = r.data.model;
    slides.push({
      slideOrder: i,
      png: r.data.png,
      width: r.data.width,
      height: r.data.height,
      role: slide.role,
      consumedAssetId: r.data.consumedAssetId,
      copy: { heading: slide.heading, body: slide.body },
    });
  }
  slides.sort((a, b) => a.slideOrder - b.slideOrder);

  /**
   * RE-ROLL A SLIDE WHOSE GROUND LEFT THE DECK.
   *
   * ~13% of slides ignore the palette swatch AND the deck anchor and come back
   * a different colour, singly and at random positions. Every input is present
   * and correct in those slides (verified from the request manifest), and the
   * corrective path, the accents, the reference set and the input order were
   * each tested and ruled out. Half of the measured cases are the slide
   * harmonising to its own photograph; the other half have no identified cause.
   * It is sampling.
   *
   * A retry needs no diagnosis, and at ~13% independent failure one attempt
   * leaves ~2%.
   *
   * IT HAS TO HAPPEN HERE. The worker's quality gate can DETECT this but not
   * repair it: its corrective path re-renders a slide as an amendment OF
   * ITSELF, handing the bad image back as "the previous version — reproduce it
   * faithfully", so the thing to be fixed is the thing it is told to copy. Only
   * this function still holds the anchor, the swatch and the planned copy, so
   * only here can a slide be rendered AGAIN rather than amended.
   */
  const coverSlide = slides.find((s) => s.slideOrder === 0);
  if (coverSlide && slides.length > 1) {
    const coverGround = await readGroundColour(coverSlide.png);
    const offDeck: CarouselSlideOutput[] = [];
    if (coverGround) {
      for (const s of slides) {
        if (s.slideOrder === 0) continue;
        const ground = await readGroundColour(s.png);
        if (
          ground &&
          colourDistance(ground, coverGround) > OFF_DECK_GROUND_DISTANCE
        ) {
          offDeck.push(s);
        }
      }
    }
    for (const s of offDeck.slice(0, MAX_COLOUR_REROLLS)) {
      const planned_ = planned[s.slideOrder];
      if (!planned_ || !anchor || !coverGround) continue;

      const originalGround = await readGroundColour(s.png);
      const before = originalGround
        ? colourDistance(originalGround, coverGround)
        : Number.POSITIVE_INFINITY;

      // KEEP THE BEST OF N, not the last of N. A re-roll is another sample and
      // can land further out than what it replaces — measured twice in eleven
      // decks — so a rejected attempt must not be the end of it.
      let best: {
        png: Buffer;
        width: number;
        height: number;
        consumedAssetId?: string;
      } | null = null;
      let bestDistance = before;
      let attempts = 0;
      for (let n = 0; n < COLOUR_REROLL_ATTEMPTS; n++) {
        const retry = await renderPlannedSlide(planned_, s.slideOrder, anchor);
        attempts++;
        if (!retry.r.success) continue;
        const ground = await readGroundColour(retry.r.data.png);
        const distance = ground
          ? colourDistance(ground, coverGround)
          : Number.POSITIVE_INFINITY;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = retry.r.data;
        }
        // Back inside the deck — stop paying for attempts that cannot help.
        if (bestDistance <= OFF_DECK_GROUND_DISTANCE) break;
      }

      log.warn('Slide ground left the deck; re-rolled', {
        event: 'content.slide_off_deck_colour',
        organizationId,
        graphicId,
        slideOrder: s.slideOrder,
        coverGround,
        before: Math.round(before),
        after: Math.round(bestDistance),
        attempts,
        kept: best !== null,
        recovered: bestDistance <= OFF_DECK_GROUND_DISTANCE,
      });

      if (best) {
        s.png = best.png;
        s.width = best.width;
        s.height = best.height;
        s.consumedAssetId = best.consumedAssetId;
      }
    }
  }

  if (droppedCorpus.length > 0) {
    log.warn('Deck rendered with slides missing', {
      organizationId,
      graphicId,
      rendered: slides.length,
      planned: planned.length,
      dropped: droppedCorpus,
    });
  }
  if (!isDeckViable(slides.map((s) => s.slideOrder))) {
    const first = results.find((x) => !x.r.success);
    return err(
      first && !first.r.success
        ? first.r.error
        : new FeatureError(
            ErrorCodes.INTERNAL_ERROR,
            'Carousel produced too few slides'
          )
    ) as Result<OrchestrateCarouselOutput>;
  }

  // Slide-numbered so a later "change slide 2" can be matched against the text
  // the owner is looking at.
  const renderedCopy = planned
    .map((slide, i) => `Slide ${i + 1}: ${slide.heading}\n${slide.body}`)
    .join('\n\n');

  return ok({ slides, model: usedModel, renderedCopy });
};

export const orchestrateCarousel = (
  db: DbConnection,
  input: OrchestrateCarouselInput
) =>
  trackedResult(
    'imageGeneration.orchestrateCarousel',
    () => orchestrateCarouselImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
        slideCount: input.slideCount,
      },
    }
  );

export type OrchestrateCarouselResult = Awaited<
  ReturnType<typeof orchestrateCarousel>
>;
