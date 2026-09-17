/**
 * Choose which of an org's own past posts become the visual references for
 * generating new ones.
 *
 * The raw feed is not usable as-is. Measured on real orgs:
 *   - ~40% of items are duplicates, because a post published to both the
 *     Facebook page and Instagram comes back twice under different ids
 *   - only ~40% of what remains is a designed graphic; the rest is team
 *     selfies, clinical before/afters, product shots and award screenshots
 *   - a colour histogram cannot tell a designed graphic from a photograph, so
 *     grouping on colour alone surfaced two text-heavy notices over the strong
 *     branded work
 *
 * Two functions, deliberately split by cost:
 *
 *   `gateInspirationCandidates` — the expensive half. Classifies each unique
 *     post once, at ingest, and caches the verdict on the row.
 *   `selectInspirationSet` — the cheap half. Pure read over cached verdicts, so
 *     it is free at generation time AND deterministic: the same corpus yields
 *     the same references, which is what makes a month of content look like one
 *     brand rather than a fresh guess per graphic.
 */

import { createAnthropicClient } from '@borradh-workspace/ai';
import { brandMediaEmbedding } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { getOrgAssetsBucket } from '@borradh-workspace/storage';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { DUPLICATE_HASH_DISTANCE, hashDistance } from '../../dhash.js';
import { ensureLogoVariants } from '../../logo-variants.js';
import { designFamilyKey, readPalette } from '../../palette.js';
import { resolveReferenceImageUrl } from '../../resolve-reference-image-urls.js';
import {
  type GateInspirationCandidatesInput,
  type InspirationVerdict,
  type SelectInspirationSetInput,
  gateInspirationCandidatesSchema,
  inspirationColourways,
  inspirationLayouts,
  selectInspirationSetSchema,
} from './select-inspiration-set.schema.js';

const VISION_MODEL = 'claude-sonnet-4-6';
/** Images per vision call. Keeps the batch cheap and the reply parseable. */
const GATE_BATCH_SIZE = 8;

/**
 * Lowest `suitability` admitted as a style reference.
 *
 * 3 means "competent and on-brand but unremarkable" — the floor of usefulness.
 * Everything below is the wrong JOB rather than a bad design, and imitating an
 * announcement produces graphics that look like announcements.
 */
const MIN_SUITABILITY = 3;
/** Longest edge sent to the gate. It judges layout, not fine detail. */
const GATE_MAX_EDGE = 512;
/** Posts older than this are a different era of the brand. */
const MAX_AGE_MONTHS = 18;

/**
 * A colourway spanning LESS than this is a campaign, not the house style.
 *
 * Calibrated against two real cases rather than guessed. One org's Black Friday
 * set is four posts inside a single day — unmistakably a campaign, and it must
 * not decide how every graphic looks for the next year. Another org's dark
 * colourway is three posts across 1.9 months, which is simply how that brand
 * posts; an earlier 2-month threshold discarded it as a burst. Half a month
 * separates the two with room to spare.
 */
const HOUSE_STYLE_MIN_SPREAD_MONTHS = 0.5;

const log = createLogger('inspirationSet');

const MONTH_MS = 1000 * 60 * 60 * 24 * 30.4;

export interface InspirationSet {
  /** Storage keys of the chosen references, newest first. */
  objectKeys: string[];
  /** Signed, model-ready URLs for the same images. */
  urls: string[];
  /** The colourway of the chosen set, e.g. `light-ground`. */
  colourway: string | null;
  /** The family it was drawn from, e.g. `light-green|type-led-panel`. */
  designFamily: string | null;
  /**
   * Share of the org's usable designs that sit in its largest design FAMILY.
   *
   * Previously measured over colourway, which flattered every brand: one org
   * scored 0.87 on colourway and 0.27 on family, and the 0.87 was reported as
   * reassurance while selection was picking the wrong posts.
   *
   * The honest reading of a low score is "this brand has no consistent visual
   * system", which no amount of clever grouping fixes — it is reported so it
   * can be seen rather than silently averaged away.
   */
  consistencyScore: number;
  /** Usable designed graphics the choice was made from. */
  candidateCount: number;
  /**
   * True when NO post in the corpus carries the org's own mark, so admission
   * fell back to accepting mark-less posts unconditionally.
   *
   * A degraded selection that looks identical to a healthy one from outside. It
   * fires for a brand that simply does not stamp its posts — and equally for one
   * that has REBRANDED, where every post predates the new mark and the
   * references therefore teach the brand the business has just left. One org's
   * entire corpus was its previous trading name; its graphics came out faithful
   * to a brand it no longer uses, and nothing on the graphic said so.
   *
   * 14 of 48 orgs with a gated corpus are in this state. Surfaced per selection
   * so it can be read off a graphic instead of recomputed from the corpus.
   */
  logoMatchFallback: boolean;
}

// ── The gate ──────────────────────────────────────────────────────────────

interface GateCandidate {
  id: string;
  objectKey: string;
  dhash: string | null;
}

/**
 * Two of the `usable` exclusions are worth stating outright, because both were
 * found by running this against real orgs rather than reasoned about:
 *
 *   - A BARE LOGO CARD passes every other test — it is designed, on-brand, and
 *     unmistakably theirs — and is a terrible style reference. One org's chosen
 *     set was two product graphics and its logo on black, which teaches "put a
 *     big logo in the middle".
 *
 *   - A PHOTO IS NOT DISQUALIFYING. An earlier version of this prompt said a
 *     photograph with a logo on it is not a design, meaning to exclude
 *     watermarked snapshots. It also excluded every photo-led design system —
 *     and for one org that WAS the house style, so the gate kept 14 branded
 *     graphics of which 9 were gold medical flyers and 3 were the sage,
 *     photo-led wellness posts that actually fill their feed. Selection then
 *     faithfully picked flyers. The test is whether the TYPE is composed, not
 *     whether a photo is present.
 *
 *   - A BROCHURE IS NOT A POST. One org's three chosen references were all
 *     dense flyers — a 200-word infographic, a price sheet with five lab tests
 *     and a footer phone number, and a ten-slide carousel flattened into one
 *     contact-sheet grid. Every one is genuinely theirs and genuinely designed,
 *     which is why an earlier "room for text" wording let them through: it
 *     described what we wanted without testing for it. Used as references they
 *     teach the model to CRAM, and the output came back over-stuffed and
 *     generic. A reference has to carry one message, because that is what the
 *     new post has to be.
 *
 *   - BRAND-COLOURED BARS ON SOMEONE ELSE'S PHOTO ARE NOT A DESIGN. A meme
 *     built on a celebrity still, captioned in the org's green, was chosen as a
 *     top-three reference: it is promotional, it has composed type and it uses
 *     the brand palette, so every other rule here waves it through.
 *
 *   - AN ADMIN POST IS NOT A MARKETING POST. A second org's chosen set was a
 *     pasted five-star review and a price-adjustment notice — both perfectly
 *     on-brand, both ninety words of centred prose with no headline. They are
 *     the wrong GENRE, which no amount of density or palette checking catches,
 *     and as references they teach the model to fill the card with a paragraph.
 *
 *   - OUR OWN PAST OUTPUT is in the corpus, because customers publish what we
 *     generate and we then ingest their published posts. One org's only two
 *     candidates were both ours, and one had rendered literal markdown
 *     asterisks into the headline. Seeding generation from that is a
 *     compounding loop: the defect becomes "the brand style" and comes back
 *     amplified. There is no reliable flag saying "we made this", so the gate
 *     rejects the SYMPTOM — a visibly broken render — which is the thing that
 *     actually matters.
 */
function buildGatePrompt(count: number, hasBrandMark: boolean): string {
  const logoLine = hasBrandMark
    ? `
  "logoMatch": "match" | "different" | "absent" — the FIRST image is the business's real uploaded logo. Compare the brand mark in THIS post against it. "match" if it is the same lockup (a different size, placement or colourway of the same mark still counts). "different" if the post carries another lockup entirely — a different icon, a different sub-line under the name (e.g. one says AESTHETICS and the other says EXCLUSIVE PRODUCT), or a different brand line. "absent" if the post carries no mark at all.`
    : '';
  return `For each image return one object. JSON array only, ${count} objects, in order.
{ "i": <index>,
  "kind": "branded-graphic" | "photo" | "before-after" | "screenshot" | "repost" | "other",
  "isDesign": <true for an original DESIGNED graphic made by this business. The test is whether the TYPE IS COMPOSED — deliberate headline, alignment, hierarchy, brand colours and shapes — NOT whether a photograph is present. A photo-led post with a properly set headline over it IS a design, and for many brands it is their entire house style. What is NOT a design: a plain snapshot with a logo watermark dropped on it and no laid-out copy, a clinical before/after with only a label, a screenshot of another app or website, or a reposted graphic from someone else.>,
  "colourway": one of ${inspirationColourways.map((c) => `"${c}"`).join(' | ')} — "light-ground" a pale/white/cream background, "dark-ground" black or near-black, "brand-colour-ground" a saturated brand colour filling the canvas, "photo-led" a photograph filling most of the frame with text over it,
  "layout": one of ${inspirationLayouts.map((l) => `"${l}"`).join(' | ')} — "type-led-panel" text dominates a flat ground, "photo-with-text-overlay" text sits directly on a photo, "split-or-two-up" the canvas is divided into two panels, "card-over-photo" a framed panel floats above an image, "minimal-type" mostly empty space with small type,
  "suitability": <0-5: how good is this post as a DESIGN TO IMITATE when generating a new marketing graphic for this business? Judge the DESIGN, not the subject or how well the post performed.
    5 — a designer would show this as an example of the brand's work: one clear message, deliberate type hierarchy, confident use of space, the mark placed properly.
    4 — a strong, on-brand marketing post with a clear focal point.
    3 — competent and on-brand but unremarkable: correct, a little plain or generic.
    2 — on-brand but the wrong JOB: an announcement, an event, an award or nomination, a community or seasonal greeting, a team introduction, a recruitment or opening-hours post. Correctly designed, but it is not the kind of post being generated, so imitating it teaches the wrong thing.
    1 — barely a design: a snapshot with a logo dropped on it, or copy with no hierarchy.
    0 — unusable as a reference at all.
    CAP AT 2 — whatever else is good about it — any post built as a MULTI-PANEL GRID: the canvas divided into three or more tiles, each with its own image and its own label, like a chart of skin types or a six-up of results. It may be an excellent post; it is an impossible model, because a graphic generated from it has to be ONE composition and imitating this one produces a grid.
    CAP AT 2 — whatever else is good about it — any post carrying SOCIAL CHROME: a swipe prompt ("swipe to see", "swipe up", a swipe arrow), an engagement instruction ("vote A or B", "comment below", "save this post", "tag a friend"), a "link in bio", pagination dots, or like/comment/share icons. Such a post is doing its job perfectly in its own feed; it is simply the wrong thing to COPY, because a graphic generated from it inherits an instruction to swipe with nothing to swipe to.
    Be strict about the 2. Most feeds are mostly 2s, and a reference set full of them produces graphics that look like announcements.>,
  "usable": <true if this would be a good STYLE REFERENCE for generating a NEW post in this brand's look. Require: composed type, room for text, and clearly this business's own branding. A photo-led post counts — do not reject it for containing a photograph.
    Set usable=false if ANY of these apply:
    - the image is essentially just a LOGO or brand card — a mark on a plain ground with no headline, body copy or content structure. It is on-brand but teaches nothing except "put the logo in the middle".
    - the rendered text shows a BROKEN RENDER: literal markdown or formatting characters left in the words (*asterisks*, _underscores_, backticks, ##), duplicated or repeated phrases, garbled or misspelled words, or text cut off by the canvas edge. These are almost always machine-generated posts that went out with a defect, and copying their look reproduces the defect.
    - the image is a CONTACT SHEET: several complete, self-contained posts tiled into one canvas, each with its own headline and its own border. This is a carousel exported as a grid, not a single design.
${logoLine}
    - the post is a MEME or built on BORROWED IMAGERY: a recognisable celebrity, film still, cartoon or stock/joke photograph the business did not shoot, with caption bars or impact-style text laid over it. Adding brand-coloured bars to someone else's picture does not make it this brand's design, and it is the wrong thing to imitate.
    - the post is an OPERATIONAL NOTICE rather than marketing: a price change, holiday or closure hours, a policy update, a hiring ad, or a customer review/testimonial reproduced on a card. These are on-brand and correctly designed; they are simply not the kind of post being generated.
    - the message is carried by a PARAGRAPH rather than a headline: several sentences of body copy at one size with nothing dominant to read first. A style reference has to show a focal point, because the new post needs one.
    - the design is a BROCHURE rather than a post: it makes many separate points at once — stacked sections, an icon row of five or six benefits, a price block, a footer bar with a phone number or handle. Judge by how much it is SAYING, not by how it looks: a good style reference carries ONE message with a clear focal point, because that is what a new post has to be.> }`;
}

async function classifyBatch(
  batch: { candidate: GateCandidate; image: Buffer }[],
  /** The org's uploaded mark, for the logoMatch judgement. Null = no logo. */
  brandMark: Buffer | null
): Promise<Map<string, InspirationVerdict>> {
  // Palette is arithmetic on the same bytes we are about to send — no extra
  // call, no extra download, and deterministic between runs.
  const palettes = await Promise.all(
    batch.map((entry) => readPalette(entry.image))
  );
  const client = createAnthropicClient();
  const content: Array<Record<string, unknown>> = [];
  // The mark goes first and is labelled, so the numbered images that follow
  // still line up with `batch` indices.
  if (brandMark) {
    content.push({
      type: 'text',
      text: "The business's REAL uploaded logo, for comparison:",
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: (
          await sharp(brandMark)
            .resize(GATE_MAX_EDGE, GATE_MAX_EDGE, {
              fit: 'inside',
              withoutEnlargement: true,
            })
            .png()
            .toBuffer()
        ).toString('base64'),
      },
    });
  }
  for (const [i, entry] of batch.entries()) {
    const small = await sharp(entry.image)
      .resize(GATE_MAX_EDGE, GATE_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 80 })
      .toBuffer();
    content.push({ type: 'text', text: `Image ${i}:` });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: small.toString('base64'),
      },
    });
  }
  content.push({
    type: 'text',
    text: buildGatePrompt(batch.length, Boolean(brandMark)),
  });

  const message = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: content as never }],
  });
  const text = message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');

  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('No JSON array in gate reply');
  const parsed = JSON.parse(text.slice(start, end + 1)) as Array<{
    i: number;
    kind?: string;
    suitability?: number;
    isDesign?: boolean;
    colourway?: string;
    layout?: string;
    usable?: boolean;
    logoMatch?: string;
  }>;

  const out = new Map<string, InspirationVerdict>();
  for (const row of parsed) {
    const entry = batch[row.i];
    if (!entry) continue;
    // Anything off-vocabulary is coerced to a value we can group on rather
    // than admitted as free text — one stray label reopens the fragmentation
    // this closed set exists to prevent.
    const colourway = inspirationColourways.includes(
      row.colourway as (typeof inspirationColourways)[number]
    )
      ? (row.colourway as (typeof inspirationColourways)[number])
      : 'light-ground';
    const layout = inspirationLayouts.includes(
      row.layout as (typeof inspirationLayouts)[number]
    )
      ? (row.layout as (typeof inspirationLayouts)[number])
      : 'type-led-panel';
    out.set(entry.candidate.id, {
      kind: row.kind ?? 'other',
      suitability:
        typeof row.suitability === 'number'
          ? Math.max(0, Math.min(5, Math.round(row.suitability)))
          : undefined,
      isDesign: Boolean(row.isDesign),
      colourway,
      layout,
      // The GROUPING key. Not `colourway|layout`: colourway describes the
      // ground, and a brand's sage-and-cream posts and its navy-and-gold
      // flyers are both "light-ground". Grouping on that merged two unrelated
      // visual systems and handed the model the wrong one.
      designFamily: designFamilyKey(palettes[row.i] ?? null, layout),
      usable: Boolean(row.usable),
      logoMatch: (['match', 'different', 'absent'] as const).includes(
        row.logoMatch as 'match' | 'different' | 'absent'
      )
        ? (row.logoMatch as 'match' | 'different' | 'absent')
        : undefined,
    });
  }
  return out;
}

const gateInspirationCandidatesImpl = async (
  db: DbConnection,
  input: GateInspirationCandidatesInput
): Promise<Result<{ gated: number; usable: number }>> => {
  const parsed = gateInspirationCandidatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, force, limit } = parsed.data;

  // Only rows we hold bytes for can be gated — a CDN URL that has expired
  // cannot be classified now or used as a reference later.
  const candidates = await db
    .select({
      id: brandMediaEmbedding.id,
      objectKey: brandMediaEmbedding.objectKey,
      dhash: brandMediaEmbedding.dhash,
    })
    .from(brandMediaEmbedding)
    .where(
      and(
        eq(brandMediaEmbedding.organizationId, organizationId),
        eq(brandMediaEmbedding.mediaType, 'image'),
        isNotNull(brandMediaEmbedding.objectKey),
        force ? undefined : isNull(brandMediaEmbedding.gatedAt)
      )
    )
    .orderBy(desc(brandMediaEmbedding.postedAt))
    .limit(limit);

  const pending = candidates.filter(
    (c): c is GateCandidate => c.objectKey !== null
  );
  if (pending.length === 0) return ok({ gated: 0, usable: 0 });

  // Dedupe BEFORE paying for vision. The cross-platform twins are ~40% of the
  // feed, and classifying both copies is money spent to learn the same fact.
  const unique: GateCandidate[] = [];
  const duplicates: GateCandidate[] = [];
  for (const c of pending) {
    const isDupe = unique.some(
      (u) =>
        (hashDistance(u.dhash, c.dhash) ?? Number.POSITIVE_INFINITY) <=
        DUPLICATE_HASH_DISTANCE
    );
    (isDupe ? duplicates : unique).push(c);
  }

  const images = await Promise.all(
    unique.map(async (candidate) => {
      try {
        const url = await resolveReferenceImageUrl(
          `s3://${getOrgAssetsBucket()}/${candidate.objectKey}`
        );
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return null;
        return { candidate, image: Buffer.from(await res.arrayBuffer()) };
      } catch {
        return null;
      }
    })
  );
  const loaded = images.filter(
    (i): i is { candidate: GateCandidate; image: Buffer } => i !== null
  );

  // The org's uploaded mark, shown to the gate so it can say whether each post
  // carries THAT logo. Best-effort: no mark just means no logoMatch verdict.
  let brandMark: Buffer | null = null;
  try {
    const variants = await ensureLogoVariants(db, organizationId);
    brandMark = variants.light
      ? Buffer.from(variants.light.data, 'base64')
      : null;
  } catch {
    brandMark = null;
  }

  const verdicts = new Map<string, InspirationVerdict>();
  for (let i = 0; i < loaded.length; i += GATE_BATCH_SIZE) {
    const batch = loaded.slice(i, i + GATE_BATCH_SIZE);
    try {
      for (const [id, verdict] of await classifyBatch(batch, brandMark)) {
        verdicts.set(id, verdict);
      }
    } catch (error) {
      // One bad batch must not lose the others. The rows stay ungated and are
      // retried on the next run.
      logError('imageGeneration.gateInspiration.batch', error, {
        feature: 'image-generation',
        extra: { organizationId, batchSize: batch.length },
      });
    }
  }

  const now = new Date();
  await Promise.all([
    ...[...verdicts].map(([id, verdict]) =>
      db
        .update(brandMediaEmbedding)
        .set({ inspirationVerdict: verdict, gatedAt: now })
        .where(eq(brandMediaEmbedding.id, id))
    ),
    // Mark duplicates gated-and-unusable so they are never re-downloaded or
    // re-classified, and can never reach a set as a second copy of a post
    // already in it.
    ...duplicates.map((d) =>
      db
        .update(brandMediaEmbedding)
        .set({
          inspirationVerdict: {
            kind: 'duplicate',
            isDesign: false,
            colourway: 'light-ground',
            layout: 'type-led-panel',
            designFamily: 'duplicate',
            usable: false,
            reason: 'near-identical to another post already in the corpus',
          },
          gatedAt: now,
        })
        .where(eq(brandMediaEmbedding.id, d.id))
    ),
  ]);

  const usable = [...verdicts.values()].filter(
    (v) => v.isDesign && v.usable
  ).length;
  log.info('Gated inspiration candidates', {
    organizationId,
    considered: pending.length,
    duplicatesSkipped: duplicates.length,
    classified: verdicts.size,
    usable,
  });

  return ok({ gated: verdicts.size + duplicates.length, usable });
};

export const gateInspirationCandidates = (
  db: DbConnection,
  input: GateInspirationCandidatesInput
) =>
  trackedResult(
    'imageGeneration.gateInspirationCandidates',
    () => gateInspirationCandidatesImpl(db, input),
    { properties: { organizationId: input.organizationId } }
  );

// ── The pick ──────────────────────────────────────────────────────────────

const selectInspirationSetImpl = async (
  db: DbConnection,
  input: SelectInspirationSetInput
): Promise<Result<InspirationSet>> => {
  const parsed = selectInspirationSetSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, setSize, colourway: forced } = parsed.data;

  const rows = await db
    .select({
      objectKey: brandMediaEmbedding.objectKey,
      postedAt: brandMediaEmbedding.postedAt,
      verdict: brandMediaEmbedding.inspirationVerdict,
    })
    .from(brandMediaEmbedding)
    .where(
      and(
        eq(brandMediaEmbedding.organizationId, organizationId),
        isNotNull(brandMediaEmbedding.objectKey),
        isNotNull(brandMediaEmbedding.inspirationVerdict)
      )
    )
    .orderBy(desc(brandMediaEmbedding.postedAt));

  /**
   * REQUIRE a post to carry the org's OWN mark.
   *
   * `logoMatch` was first written to exclude only `different` — a post with no
   * mark, the reasoning went, cannot teach a WRONG mark. True about the logo,
   * and wrong about everything else: a post with no mark can still teach an
   * entirely wrong BRAND.
   *
   * The case that broke it: one org's 16-item pool was 6 of her own teal,
   * botanical, `KAREN BOWERS / SKIN & BEAUTY` posts and 10 belonging to a
   * different business entirely — beige editorial product marketing for
   * At Home Pampering and Dermalogica, down to `athomepampering.ie` in the
   * footer. All 10 were `absent`, so all 10 survived. 62% of the pool was
   * another brand.
   *
   * So `match` is required. Fewer references beat wrong ones — the whole day's
   * evidence points that way.
   *
   * FALLBACK, and only this one: an org with NO `match` anywhere falls back to
   * `absent`, because zero references is not neutral. It sends generation down
   * its no-references branch and onto the stored hex, which produced the worst
   * output measured all day. Logged, because an org in that state has either no
   * logo on file or a mark that appears nowhere in its own feed, and both are
   * worth knowing about.
   */
  const gated = rows.filter(
    (r) =>
      // `kind` AND `isDesign`, not one or the other. `kind` is a
      // classification and the reliable half; `isDesign` is a judgement call
      // that has been wrong in both directions. Keeping both means the two
      // disagreeing costs us a reference rather than admitting a bad one.
      r.verdict?.kind === 'branded-graphic' &&
      r.verdict?.isDesign &&
      r.verdict?.usable &&
      r.objectKey
  );
  const hasOwnMark = gated.some((r) => r.verdict?.logoMatch === 'match');
  if (!hasOwnMark && gated.length > 0) {
    log.warn("No reference carries this brand's own mark", {
      event: 'content.no_matching_logo_reference',
      organizationId,
      candidates: gated.length,
    });
  }

  const now = Date.now();
  /**
   * Matched posts lead; mark-less posts TOP UP from the same design family.
   *
   * Requiring `match` outright exists because admitting `absent` once let ten
   * of another business's posts into an org's pool — a post with no mark
   * cannot teach a wrong logo, but it can belong to someone else entirely.
   *
   * All-or-nothing was too blunt. A salon that stamps its logo on three posts
   * out of twenty-eight had 25 candidates discarded and selected from the
   * remaining three, one of which was a blurry shopfront captioned "April
   * offers". Plenty of brands simply do not brand every post.
   *
   * So an unmarked post is admitted only when it sits in the SAME design family
   * — same palette, same layout — as a post that DOES carry the org's mark.
   * That is the cheap test for "same brand" without a mark to compare: another
   * business's post will rarely share this one's palette and composition, and
   * if it does, it is at least a coherent reference.
   */
  const matchedFamilies = new Set(
    gated
      .filter((r) => r.verdict?.logoMatch === 'match')
      .map((r) => r.verdict?.designFamily)
      .filter((f): f is string => Boolean(f))
  );
  const designs = gated
    .filter((r) => {
      if (!hasOwnMark) return r.verdict?.logoMatch !== 'different';
      if (r.verdict?.logoMatch === 'match') return true;
      return (
        r.verdict?.logoMatch === 'absent' &&
        Boolean(r.verdict?.designFamily) &&
        matchedFamilies.has(r.verdict.designFamily)
      );
    })
    .map((r) => ({
      objectKey: r.objectKey as string,
      colourway: r.verdict?.colourway ?? 'light-ground',
      family: (r.verdict?.designFamily ?? 'unknown').split('|')[0],
      layout: r.verdict?.layout ?? 'type-led-panel',
      // Rows gated before scoring existed have no score. Treat those as 3
      // (competent, unremarkable) rather than 0, so an un-rescored org keeps
      // working instead of silently losing its whole pool.
      suitability: r.verdict?.suitability ?? 3,
      ageMonths: r.postedAt
        ? (now - r.postedAt.getTime()) / MONTH_MS
        : Number.POSITIVE_INFINITY,
    }))
    .filter((d) => d.ageMonths <= MAX_AGE_MONTHS)
    // Below 3 is "on-brand but the wrong JOB" — an announcement, an award
    // plea, a team introduction. Correctly designed and useless to imitate:
    // two of them were the references behind a whole day of poor renders.
    .filter((d) => d.suitability >= MIN_SUITABILITY);

  if (designs.length === 0) {
    return ok({
      objectKeys: [],
      urls: [],
      colourway: null,
      designFamily: null,
      consistencyScore: 0,
      candidateCount: 0,
      logoMatchFallback: !hasOwnMark,
    });
  }

  // Group by PALETTE, not colourway — colourway describes the ground, so a
  // brand's sage posts and its gold flyers were both `light-ground` and got
  // merged into one bucket.
  const groups = new Map<string, typeof designs>();
  for (const d of designs) {
    groups.set(d.family, [...(groups.get(d.family) ?? []), d]);
  }

  const spread = (members: typeof designs) =>
    Math.max(...members.map((m) => m.ageMonths)) -
    Math.min(...members.map((m) => m.ageMonths));

  const ranked = [...groups].sort((a, b) => b[1].length - a[1].length);
  // Rank by whether a group looks like the HOUSE STYLE rather than by raw
  // count: a campaign burst has many posts over a few days, the everyday look
  // recurs across months.
  const houseStyle = ranked.filter(
    ([, m]) => m.length >= 2 && spread(m) >= HOUSE_STYLE_MIN_SPREAD_MONTHS
  );
  const chosen =
    (forced
      ? ranked.find(([, members]) => members[0]?.colourway === forced)
      : undefined) ??
    houseStyle[0] ??
    ranked[0];
  const members = chosen?.[1] ?? designs;

  /**
   * Newest first, but the family's MODAL layout ahead of the rest.
   *
   * A family shares a palette and nothing else, so a straight newest-first cut
   * can hand back three unrelated compositions. Leading with the layout the
   * brand uses most makes the set read as one system, while the remaining slots
   * still admit other layouts — that variety is deliberate, because three
   * copies of one composition teach the model to reproduce it rather than to
   * work in the brand's range.
   */
  const layoutCounts = new Map<string, number>();
  for (const m of members) {
    layoutCounts.set(m.layout, (layoutCounts.get(m.layout) ?? 0) + 1);
  }
  const modalLayout = [...layoutCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const picked = [...members]
    .sort((a, b) => {
      // SUITABILITY FIRST. Coherence used to decide everything — largest
      // palette family, then its modal layout — so selection could only ever
      // answer "which posts look like each other?", never "which are any
      // good?". A brand whose feed is mostly announcements has a very
      // coherent family of announcements.
      if (a.suitability !== b.suitability) return b.suitability - a.suitability;
      const aModal = a.layout === modalLayout ? 0 : 1;
      const bModal = b.layout === modalLayout ? 0 : 1;
      return aModal - bModal || a.ageMonths - b.ageMonths;
    })
    .slice(0, setSize);

  /**
   * TOP UP from the next-best families when the chosen one is short.
   *
   * The gate is deliberately strict — it rejects brochures, operational
   * notices, contact sheets and memes — and each rule that made the picks
   * better also made the pool smaller. One org went from 24 usable items to 12
   * across those rules, at which point its best family held only two and
   * selection returned a two-image set.
   *
   * Two on-brand references are worse than three, not better: the third slot is
   * what stops the model latching onto one composition. Filling it from a
   * sibling family costs a little coherence and buys back the range, which is
   * the right trade — and it means the gate can be tightened further without
   * silently degrading the set size.
   */
  if (picked.length < setSize) {
    const already = new Set(picked.map((p) => p.objectKey));
    const spare = [...houseStyle, ...ranked]
      .flatMap(([, m]) => m)
      // A FORCED colourway is a caller instruction, not a preference — a deck
      // pins one so every slide matches. Topping up across it would quietly
      // break the guarantee the parameter exists to give.
      .filter((d) => (forced ? d.colourway === forced : true))
      .filter((d) => !already.has(d.objectKey))
      .sort((a, b) => a.ageMonths - b.ageMonths);
    for (const d of spare) {
      if (picked.length >= setSize) break;
      if (already.has(d.objectKey)) continue;
      already.add(d.objectKey);
      picked.push(d);
    }
  }

  const largest = ranked[0]?.[1].length ?? 0;
  const objectKeys = picked.map((p) => p.objectKey);

  // The CHOICE is the result; signing is a convenience on top of it. Keep them
  // separable so a storage-config problem surfaces as a storage-config problem
  // rather than as "this brand has no references", which is precisely the
  // silent-degradation shape this whole change exists to remove.
  let urls: string[] = [];
  try {
    const bucket = getOrgAssetsBucket();
    urls = await Promise.all(
      objectKeys.map((key) => resolveReferenceImageUrl(`s3://${bucket}/${key}`))
    );
  } catch (error) {
    log.error('Could not sign inspiration reference URLs', {
      organizationId,
      keys: objectKeys.length,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return ok({
    objectKeys,
    urls,
    colourway: chosen?.[1][0]?.colourway ?? null,
    designFamily: chosen?.[0] ?? null,
    consistencyScore: designs.length ? largest / designs.length : 0,
    candidateCount: designs.length,
    logoMatchFallback: !hasOwnMark,
  });
};

export const selectInspirationSet = (
  db: DbConnection,
  input: SelectInspirationSetInput
) =>
  trackedResult(
    'imageGeneration.selectInspirationSet',
    () => selectInspirationSetImpl(db, input),
    {
      properties: { organizationId: input.organizationId },
      internalErrorsOnly: true,
    }
  );

export type SelectInspirationSetResult = Awaited<
  ReturnType<typeof selectInspirationSet>
>;
