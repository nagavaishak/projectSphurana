/**
 * `generateBrandedGraphic` — single-shot AI branded-graphic generation.
 *
 * The "nano banana" path that replaces the Fabric template renderer when
 * GRAPHICS_ENGINE='nano-banana'. Produces a finished, on-brand PNG from:
 *
 *   - SUBJECT: the org's REAL uploaded service media (video thumbnail / photo
 *     of the service being done), resolved via `resolveSlotImage` tiers 1/2
 *     with AI disabled. We NEVER fabricate imagery of the service when real
 *     media exists — that is a hard product rule.
 *   - STYLE: a small coherent SET of the org's own past posts
 *     (`selectInspirationSet`) — carries layout / fonts / colours.
 *   - LOGO: the org's logo (signed for fetch).
 *   - A deliberately MINIMAL prompt (over-specifying fights the model).
 *
 * Which sources are eligible, and in what order, is ONE named `ImageryPolicy`
 * (see `../../imagery-policy.ts`) rather than a set of booleans. What was
 * actually chosen travels as a tagged `ImagerySource`, so the prompt can say
 * truthfully whether it is holding the client's own photograph, a shared stock
 * still, or nothing at all.
 *
 * Returns raw PNG bytes; the caller (worker) uploads to S3 + flips the graphic
 * row to ready, keeping the existing frontend contract identical.
 */

import { organization, organizationService } from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  type ProvenanceMediaSource,
  recordProvenanceSafe,
} from '../../../content-provenance/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import {
  PALETTE_SWATCH_ROLE,
  buildPaletteSwatch,
  readBrandPalette,
} from '../../brand-swatch.js';
import { findPriorChosenAssetIds } from '../../find-prior-chosen-asset.js';
import { type GeminiImageInput, callGeminiImage } from '../../gemini-image.js';
import {
  type GraphicPrompt,
  type RenderCopy,
  serialiseGraphicPrompt,
} from '../../graphic-prompt.js';
import {
  RULE_COMPOSE_THE_PHOTO,
  RULE_NO_BEFORE_AFTER,
  RULE_NO_PALETTE_FROM_PHOTO,
  RULE_NO_REFERENCE_PHOTOS,
  RULE_NO_SOCIAL_CHROME,
  RULE_NO_TEXT_FROM_PHOTO,
  RULE_ONE_SLIDE,
} from '../../graphic-rules.js';
import {
  type ImagerySource,
  type ImagerySourceKind,
  imageryPolicyFromLegacyFlags,
  policyAllowsAi,
  sourceIsAuthentic,
  sourceSuppliesImage,
} from '../../imagery-policy.js';
import {
  type LogoVariants,
  ensureLogoVariants,
  imageLuminanceFromBase64,
  pickLogoForBackground,
} from '../../logo-variants.js';
import {
  type RegenerationIntent,
  amendmentDirective,
  inferRegenerationIntent,
  inputsForIntent,
} from '../../regeneration-intent.js';
import { resolveReferenceImageUrl } from '../../resolve-reference-image-urls.js';
import { resolveSlotImage } from '../resolve-slot-image/index.js';
import type { ResolveSlotImageSource } from '../resolve-slot-image/resolve-slot-image.service.js';
import {
  type GenerateBrandedGraphicInput,
  generateBrandedGraphicSchema,
} from './generate-branded-graphic.schema.js';

// Output canvas — matches the Fabric path's 4:5 portrait (1080×1350).
/**
 * How many alternative photographs to try before rendering text-only.
 *
 * Two, because the pools are small — five usable assets is typical and one org
 * had two — so a third rotation usually re-offers something already refused
 * while costing another paid image call.
 */
const MAX_REFUSAL_ROTATIONS = 2;

const CANVAS = { w: 1080, h: 1350 };

const logger = createLogger('BrandedGraphic');

/** Cap input-image longest edge to bound the request payload / token cost. */
const INPUT_MAX_EDGE = 1024;

export interface GenerateBrandedGraphicOutput {
  /**
   * The copy text rendered onto the graphic, when the caller planned copy.
   * Persisted by the worker so the next regenerate can amend it rather than
   * inventing a new one.
   */
  renderedCopy?: string;
  png: Buffer;
  /** Actual pixel dimensions of the returned PNG (4:5, ~1080×1350). */
  width: number;
  height: number;
  model: string;
  /** True when the SUBJECT came from real uploaded service media. */
  usedServiceMedia: boolean;
  /**
   * Where the subject imagery came from. `usedServiceMedia` is the same fact
   * flattened to a boolean and cannot distinguish stock from nothing — this
   * can, which is what makes two imagery policies comparable in a sample run.
   */
  imagerySource: ImagerySourceKind;
  /** The asset this render used, so a re-render can pin the same photograph. */
  consumedAssetId?: string;
  /** How many style references were available + passed. */
  referenceCount: number;
}

/** Fetch a remote image → downscaled JPEG base64 for an inlineData part. */
/**
 * Fetch an image and downscale it into a Gemini input.
 *
 * ALWAYS re-signs first. Stored URLs are CloudFront-signed with a ONE HOUR
 * expiry (`uploadPng` in the graphic worker), so anything read back from the
 * database later — a prior render, a brand reference — is a 403 waiting to
 * happen. This used to `fetch` the stored value raw and return null on
 * failure, silently, which is why "request changes" appeared to work when a
 * graphic was regenerated immediately and re-rolled from scratch when the
 * owner came back to it hours later.
 */
async function fetchImageAsInput(
  stored: string
): Promise<GeminiImageInput | null> {
  try {
    const url = await resolveReferenceImageUrl(stored).catch(() => stored);
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const raw = Buffer.from(await res.arrayBuffer());
    const small = await sharp(raw)
      .resize(INPUT_MAX_EDGE, INPUT_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    return { data: small.toString('base64'), mediaType: 'image/jpeg' };
  } catch {
    return null;
  }
}

interface OrgBrand {
  name: string;
  logo: string | null;
  fontImageUrl: string | null;
  /**
   * Brand colour. Used ONLY when the org has no reference posts to look at —
   * it is populated by default for every org, so it is a weak signal next to
   * the brand's own work.
   */
  primaryColor: string;
}

interface ServiceInfo {
  name: string;
  description: string | null;
  targetArea: string | null;
}

/**
 * What this graphic is ABOUT, phrased so it cannot be mistaken for copy.
 *
 * The renderer used to receive `Service: {name} — {description}.` as a bare
 * line, and the model drew it: a single came back reading
 * `Service: Extra Large Area - Laser Single Session | Female`, label and pipe
 * included, on all four renders of one batch. The description leaked too —
 * `was 150 euro now 130 euro … look like younger you` is what one owner typed
 * into their service record, and it appeared as body copy on decks that were
 * never given an offer.
 *
 * Two changes. The DESCRIPTION is gone entirely: it is a CRM field written for
 * staff, not a design brief, and the copy planner has already used it upstream
 * to write the words this render should show. And the service NAME is now
 * described rather than labelled — a raw internal name like
 * `Extra Large Area - Laser Single Session | Female` is a database row, not a
 * headline, so the model is told to write about it, never to print it.
 */
/**
 * With no template, the brand's own post IS the design.
 *
 * Every composition instruction in this prompt used to be conditional on a
 * template: "copy its composition, structure, crops and text placement
 * FAITHFULLY" fires only in templateMode, and the deck anchor only on slides
 * 2+. Strip the template and the model is left with a palette, a typeface, a
 * logo and a list of prohibitions — no statement of what a good graphic looks
 * like and no instruction to imitate anything. It answered that brief exactly:
 * generic type over a photograph, four times.
 *
 * The reference was nominally the style source, but it said so in two words —
 * "layout feel" — inside a role label, next to a logo directive twenty times
 * its length. This says it as a directive, and names what "style" actually
 * consists of, because a brand's design language is its composition and scale
 * relationships at least as much as its colours.
 *
 * Deliberately says nothing about WHICH colours, typefaces or shapes: those
 * come from the reference itself, and naming them here would put this in
 * competition with it — the mistake `7b2c09541` removed from the templates.
 *
 * The "not its words" clause is load-bearing. Given ONE reference the model
 * lifted its headline verbatim: a reference reading "3 Things You Need to Know
 * About Brazilian Wax" produced a graphic headed "3 Things You Need to Know"
 * listing two items.
 */
/**
 * Composition craft, for renders that have no layout spec at all.
 *
 * This is the doc's "untried third option": prose RICH about composition and
 * SILENT about appearance. The two configurations that had been measured were
 * appearance-rich layout prompts, which overrode the brand, and no layout at
 * all, which produced "centred text, flat fill, no structure". Briefs put every
 * organic render into the second state — they deliberately carry no
 * composition — and the output showed exactly the predicted faults: body copy
 * running across a photograph, a picture dropped mid-canvas with no relationship
 * to the type, headline and body at nearly the same size.
 *
 * Every clause below transfers across brands and none of it competes with the
 * design model, which owns palette, typeface, texture and photographic
 * treatment. This owns only where things sit and how big they are relative to
 * each other.
 *
 * The photograph clause is first because it is the defect that keeps shipping:
 * the model will happily set a paragraph across a pair of legs.
 */
const COMPOSITION_CRAFT_DIRECTIVE =
  "NO INVENTED ORNAMENT. Do not add tick marks, checkboxes, bullets, arrows, stars, icons, badges, ribbons or decorative rules that the copy did not ask for. If the copy is not a list, do not set it as one; if it is a list, use the brand's own device for a list if its posts show one, and plain line breaks otherwise. A tick beside a single sentence is not a design decision, it is filler. " +
  'COMPOSITION. Text and photograph occupy SEPARATE areas of the canvas — never set body copy over a photograph unless the photograph has a large, genuinely plain region to hold it, and never let a line of text cross the edge of a picture, a panel or a colour block. How the photograph MEETS the canvas is a real design decision with several right answers: it may fill the frame entirely, bleed off one or two edges, fill a panel or band, sit in an arch or soft-cornered shape, or be inset with a margin. Choose the one the design model uses — do NOT default to a plain rectangle floating in the middle of the canvas with space all around it, which reads as a placeholder rather than a composition. Establish ONE dominant element and let everything else recede: the headline should be clearly larger than the body, and the body clearly larger than any footer or mark. Keep a consistent margin on all four sides and do not let any element touch or cross the canvas edge. Group related lines tightly and leave real space between groups, rather than spreading everything evenly down the canvas. Align text to a single edge — do not mix left-aligned and centred blocks in one graphic. Leave the composition breathing: empty space is part of the design, not a gap to fill.';

const DESIGN_MODEL_DIRECTIVE =
  'THE BRAND EXAMPLE POST IS YOUR DESIGN MODEL — treat it the way a designer treats a previous piece in the same series. Build this graphic in ITS design language: divide the canvas the same way, use the same kind of hierarchy and the same scale relationships (how much bigger the headline is than the body, how small the mark sits), match how dense or airy it is, and TREAT THE PHOTOGRAPH THE WAY IT DOES: give it the same share of the canvas, the same shape and crop, the same relationship to the edges — bled off, framed, inset, full-bleed or absent — and the same relationship to the type, whether the words sit over it, beside it or beneath it. If the design model has no photograph, this graphic may have none either. Reuse its structural devices such as panels, rules, oversized numerals or framing shapes. Give this graphic ONE dominant element and ONE message, as it does. What you must NOT take from it: its words, its headline, its numbers, its claims and its photograph — those belong to that post, not this one.';

/**
 * Name the GROUND the brand works on.
 *
 * `selectInspirationSet` classifies every org's posts into one of four grounds
 * and the renderer was never told which. "Take the palette from the example
 * posts" leaves the single most visible decision — is this design light or
 * dark? — to be inferred from one image, and it is inferred wrongly often
 * enough to matter: a `light-ground` brand produced two near-black singles out
 * of three from a pale reference.
 */
/**
 * PROMPT ABLATION — a component may be switched off to find out what it costs.
 *
 * `PROMPT_ABLATE` is a comma-separated list of component tags to OMIT. Unset
 * means every component ships, which is the production path; nothing about this
 * changes behaviour unless the variable is set.
 *
 * It exists because reasoning about which instruction causes a symptom has been
 * wrong repeatedly: a clause can be present and losing, absent and blamed, or
 * contradicted by another three sentences later, and the rendered image looks
 * the same in every case. Removing one component at a time and re-rendering
 * answers it directly.
 *
 * Structural safety rules (one-slide, no-social-chrome) are deliberately NOT
 * ablatable — they prevent defects unrelated to what is being measured, and
 * dropping them would just add noise.
 *
 * The tags: `anchor`, `brand-example-line`, `brand-examples`, `design-model`,
 * `framing`, `ground`, `handle`, `logo`, `photo`, `precedence`, `subject`,
 * `swatch`, `trailing`, `typography`.
 */
/**
 * READ PER CALL, NEVER HOISTED TO A MODULE CONST.
 *
 * This was `const ABLATED = new Set(process.env.PROMPT_ABLATE…)` at module
 * scope, which is evaluated ONCE when the module is imported. Every harness
 * that drives this in-process sets `process.env.PROMPT_ABLATE` before each
 * render — after the import has already happened — so the set was empty for the
 * whole run and every "ablated" configuration rendered the FULL production
 * prompt.
 *
 * The cost of that was two complete experiments. A nine-row ablation and a
 * fourteen-row build-up both came back as noise with no component mattering,
 * which was read as "no clause controls the ground" when it actually meant
 * "every row was the same request". The tell was there in the first prompt
 * dump: a row with framing, subject, typography, logo, handle and photo all
 * supposedly removed was 6,770 characters and three images.
 *
 * Re-reading the variable per call costs a string split perhaps fifteen times
 * per render, against a network call to an image model. It is not worth
 * caching, and caching it is what broke it.
 */
function ablatedTags(): ReadonlySet<string> {
  return new Set(
    (process.env.PROMPT_ABLATE ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
  );
}

/** True when a tagged prompt component should be included. */
export function promptComponentEnabled(tag: string): boolean {
  return !ablatedTags().has(tag);
}

function groundDirective(colourway?: string): string | null {
  switch (colourway) {
    case 'light-ground':
      return 'GROUND: this brand works on a PALE ground — white, cream or off-white — with dark type on it. Build this graphic that way. Do NOT invert it to a dark or black background, even if a photograph in the design is dark.';
    case 'dark-ground':
      return 'GROUND: this brand works on a DARK ground — black or near-black — with light type on it. Build this graphic that way. Do NOT lighten it to a white or cream background.';
    case 'brand-colour-ground':
      return 'GROUND: this brand fills the canvas with a saturated BRAND COLOUR taken from its own posts, rather than white or black. Build this graphic that way.';
    case 'photo-led':
      return 'GROUND: this brand is PHOTO-LED — a photograph fills most of the frame with type set over it. Build this graphic that way rather than as type on a flat panel.';
    default:
      return null;
  }
}

function subjectContext(service: ServiceInfo, topic: string): string {
  return `CONTEXT — describes what this graphic is about, and is never itself text to draw: the business offers a service internally recorded as "${service.name}". That is an internal record, not a headline: never print it verbatim, never print the words "Service:", and never reproduce its punctuation, codes or category suffixes. The subject of this graphic is: ${topic}.`;
}

/**
 * What to do with the photographic area, given what we are actually holding.
 *
 * This switches on PROVENANCE, not on a boolean. The previous version took a
 * `hasServiceMedia: boolean` that was true for a stock library still just as it
 * was for the client's own photograph, and told the model both were "the
 * PROVIDED real service photo" it should place and match the crop of. A stock
 * IV drip therefore arrived in a cryotherapy deck as an instruction rather than
 * a suggestion, and turning on "allow AI images" could not overrule it because
 * the concrete image and the permission to invent were the same channel.
 */
/**
 * @param hasLayout whether a layout spec accompanies this render. Without one
 * the "only if the layout has a photographic area" framing is meaningless — the
 * composer decides — so the same rules are stated against the CANVAS instead.
 */
function buildTemplatePhotoInstruction(
  kind: ImagerySourceKind,
  hasLayout = true,
  ownerPinnedPhoto = false
): string {
  const gate = hasLayout
    ? 'only add a photo if the layout actually has a photographic area'
    : 'give the photograph its own clear area of the canvas';
  const typeOnly = hasLayout
    ? 'If the layout is type-only / text-only, do NOT add any photo at all.'
    : '';
  switch (kind) {
    case 'org-asset':
      // A PICKED PHOTO IS NOT A SUGGESTION.
      //
      // Every branch of this instruction is written around a GATE — "only add a
      // photo if the layout actually has a photographic area" — and closes with
      // an explicit licence to drop the photo entirely when the layout reads as
      // type-only. That is right when the resolver merely FOUND a photo, and
      // wrong when the owner opened the picker and chose this one: the model
      // takes the escape hatch, returns a handsome type-only card, and the
      // owner's photograph is nowhere in the graphic they asked it to be in.
      //
      // So when the photo was pinned by hand, the gate and the type-only
      // licence are both removed and the layout is told to yield to the photo
      // instead of the other way round.
      if (ownerPinnedPhoto) {
        return `IMPORTANT: the PROVIDED photograph MUST appear in this graphic — the business chose this exact picture for this post, and a version without it is a failed render. Give it a real, prominent area of the composition (not a thumbnail, a watermark, or a sliver at the edge) and build the layout around it; if the layout you would otherwise use is type-only, ADAPT it so the photograph fits. Do NOT substitute it, do NOT regenerate or re-imagine it, and do NOT invent a different scene — it is this business's own picture of their real work, so use it as the subject and match its crop/treatment. ${RULE_NO_TEXT_FROM_PHOTO} ${RULE_NO_PALETTE_FROM_PHOTO}`;
      }
      return `IMPORTANT: ${gate}. Place the PROVIDED photograph there — it is this business's own picture of their real work, so use it as the subject and match its crop/treatment. ${RULE_NO_TEXT_FROM_PHOTO} ${RULE_NO_PALETTE_FROM_PHOTO} ${typeOnly}`;
    case 'stock':
      // Deliberately permissive. Stock is a shared library that does not depict
      // this business, and the pool is thin enough that a generic clip
      // regularly has nothing to do with the service — an IV drip for a facial.
      // Pinning it as fact is worse than letting the model treat it as a mood
      // suggestion it may crop, abstract or set aside.
      return `IMPORTANT: ${gate}. A STOCK library photograph is supplied — it is NOT this business's own work and does not show their premises, staff or clients. Use it for mood, palette and crop if it genuinely suits the subject; if it does not fit the topic, prefer an abstract, textural or brand-colour treatment over forcing it in. Do NOT present it as evidence of this business's results. ${RULE_NO_TEXT_FROM_PHOTO} ${RULE_NO_PALETTE_FROM_PHOTO} ${typeOnly}`;
    case 'ai-fill':
      return `IMPORTANT: ${gate}. A generated photograph is supplied — place it and match its crop. ${RULE_NO_TEXT_FROM_PHOTO} ${RULE_NO_PALETTE_FROM_PHOTO} ${typeOnly}`;
    case 'model-invented':
      // PREFER A PLACE OR A DETAIL OVER AN INVENTED PERSON.
      //
      // The model reaches for a smiling woman by default: one five-slide deck
      // came back with invented people on three slides, all presented as this
      // business's clients or staff. They are permitted by the policy and
      // correctly logged as warnings — but a feed of strangers is not what an
      // owner wants, and a room, a texture or a pair of hands carries the same
      // slide without asserting anyone.
      return "IMPORTANT: only add a photo if the layout has a photographic area; then compose a fitting image yourself in the layout's style and crop (do not reproduce any reference's faces or exact photograph). PREFER imagery with NO identifiable person in it — the treatment room, the equipment, materials, textures, hands at work, the view from the space. Invent a whole person only when the slide genuinely cannot work without one, and never show more than one invented person across a set. Do NOT present invented imagery as a real client result, and never produce a before/after pair. If the layout is type-only / text-only, do NOT add any photo.";
    case 'none':
      return 'IMPORTANT: only add a photo if the layout has a photographic area; because no photograph is provided and invented imagery is not permitted, replace any photo area with a clean brand-colour panel, abstract texture, gradient, shapes, or empty space that preserves the layout. Do NOT invent or generate people, faces, skin, bodies, treatment/procedure scenes, clinic rooms, before/after results, or service imagery. If the layout is type-only / text-only, do NOT add any photo at all — keep it text-only.';
  }
}

/**
 * How an injected bitmap is INTRODUCED to the model, which must match how the
 * instruction above then talks about it.
 */
function subjectPhotoRole(
  imagery: ImagerySource,
  ownerPinnedPhoto = false
): string {
  switch (imagery.kind) {
    case 'org-asset':
      // The manifest is how each attachment is INTRODUCED, and it has to agree
      // with the instruction above — an image announced as merely available
      // while the directive calls it mandatory gives the model two readings.
      return ownerPinnedPhoto
        ? "this business's OWN photograph, CHOSEN BY THEM for this graphic — it MUST appear as the subject/background imagery; do not swap it, regenerate it, or invent a different scene"
        : "this business's OWN photograph of their real work — use it as the subject/background imagery; do not invent a different scene";
    case 'stock':
      return "a STOCK library photograph — generic imagery, NOT this business's own work. Use it only if it suits the subject";
    case 'ai-fill':
      return "a GENERATED photograph for the layout's photographic area";
    default:
      return 'subject imagery';
  }
}

/**
 * Deck-wide typography lock. A carousel renders each slide as a SEPARATE Gemini
 * call, so nothing stops the model from copying each layout reference's own
 * fonts — producing a set where one slide is all-sans, the next all-serif, etc.
 * (ENG-542). This directive pins ONE type system (identical for every slide,
 * since every slide derives it from the same org inputs) and tells the model to
 * express the layout's "serif/sans" roles with the BRAND's fonts, not the
 * reference's.
 */
function buildTypographyDirective(args: {
  hasFontReference: boolean;
  /** Whether any of the brand's own posts were supplied as image inputs. */
  hasBrandExamples: boolean;
  isCarouselSlide: boolean;
}): string {
  const { hasFontReference, hasBrandExamples, isCarouselSlide } = args;
  const source = hasFontReference
    ? 'Take the typeface from the FONT reference image and use it for ALL text.'
    : hasBrandExamples
      ? 'Take the typefaces from the BRAND example posts and use them for ALL text.'
      : 'Use a refined, high-contrast serif for headings and a clean modern sans-serif for body copy.';
  const consistency = isCarouselSlide
    ? ' Use the IDENTICAL fonts on every slide of this set — one heading font and one body font throughout; never switch fonts between slides.'
    : '';
  return `TYPOGRAPHY (a single consistent type system): ${source}${consistency} Where the layout reference implies a "serif" or "sans" style, express it with these brand fonts — do NOT copy the fonts shown in the layout/reference images.`;
}

/**
 * The single canonical handle/URL string rendered in a slide footer. Carousel
 * slides are independent Gemini calls, so with no shared value the model invents
 * a different footer per slide (ENG-542: @GlitterGirlsBeauty vs
 * @glittergirlsbeauty vs the website). Deriving ONE string here — identical for
 * every slide of an org — pins it. Prefers an explicit override, then the IG
 * handle (→ "@handle"), then the website domain. Returns null when the org has
 * neither, and the prompt then omits the handle bar entirely.
 */
function deriveBrandHandle(args: {
  override?: string;
  instagramLink?: string | null;
  websiteUrl?: string | null;
}): string | null {
  const { override, instagramLink, websiteUrl } = args;
  if (override?.trim()) return override.trim();
  if (instagramLink?.trim()) {
    // Accept a full URL, a bare handle, or an "@handle" → normalise to "@handle".
    const seg = instagramLink.trim().replace(/\/+$/, '').split('/').pop() ?? '';
    const handle = seg.replace(/^@/, '').split('?')[0];
    if (handle) return `@${handle}`;
  }
  if (websiteUrl?.trim()) {
    // Bare domain: drop protocol + www + any path/query.
    const domain = websiteUrl
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/.*$/, '');
    if (domain) return domain;
  }
  return null;
}

function buildPrompt(args: {
  brand: OrgBrand;
  service: ServiceInfo;
  topic: string;
  format: string;
  /** What the imagery resolution actually produced, with provenance. */
  imageryKind: ImagerySourceKind;
  /**
   * True when the subject photo is one the owner PICKED for this graphic
   * (explicit `sourceAssetIds`), rather than one the resolver found for them.
   * A picked photo is mandatory; a found one defers to the layout.
   */
  ownerPinnedPhoto: boolean;
  /** True when an inspiration TEMPLATE drives this graphic (its layout is law). */
  templateMode: boolean;
  /** True when an actual inspiration IMAGE was supplied (vs text layout only). */
  hasInspirationImage: boolean;
  /**
   * True when a text layout SPEC was supplied, with or without an image.
   *
   * Separate from `templateMode` because the two answer different questions and
   * the prompt needs both: `templateMode` asks "is there a layout at all", this
   * asks "is that layout PROSE" — and prose and the design model can both be
   * present, which no earlier configuration allowed.
   */
  hasLayoutPrompt: boolean;
  /** True when the brand logo image is provided as an input. */
  hasLogo: boolean;
  /**
   * True when this graphic deliberately carries NO branding — a carousel slide
   * that is not the cover or a brand card. Distinct from `hasLogo: false`,
   * which means the ORG has no logo on file; that is a data gap worth
   * reporting, this is a design decision.
   */
  logoSuppressed: boolean;
  /** True when a brand FONT reference image is provided as an input. */
  hasFontReference: boolean;
  /** How many of the brand's own posts were supplied as image inputs. */
  brandReferenceCount: number;
  /** True when this graphic is one slide of a multi-slide carousel set. */
  isCarouselSlide: boolean;
  /** Canonical handle/URL for the footer, or null to omit it. */
  brandHandle: string | null;
  /** Free-text user change request — highest priority when present. */
  refinementInstruction?: string;
  /** What this render is changing — decides the amendment wording. */
  intent: RegenerationIntent;
  /** The ground the brand's own posts sit on, or undefined if unknown. */
  referenceColourway?: string;
  deckGroundColour?: string;
  /** Instructions ABOUT the render that arrive from the caller. */
  trailingDirectives: string[];
  /** The exact strings TO render. Never joined with the directives. */
  copy: RenderCopy | null;
}): GraphicPrompt {
  const {
    brand,
    service,
    topic,
    format,
    imageryKind,
    ownerPinnedPhoto,
    templateMode,
    hasInspirationImage,
    hasLayoutPrompt,
    hasLogo,
    logoSuppressed,
    hasFontReference,
    brandReferenceCount,
    isCarouselSlide,
    brandHandle,
    refinementInstruction,
    intent,
  } = args;
  const lines: string[] = [];

  // ONE slide, full frame. The curated layout references are real Instagram
  // carousel SCREENSHOTS, so the model sometimes "reproduces the carousel" —
  // tiling several slides into one image (a contact-sheet / inception). Forbid
  // that explicitly, up front, so every render is a single full-bleed slide.
  lines.push(RULE_ONE_SLIDE);

  /**
   * CONTENT-SAFETY RULES SHIP WITH EVERY RENDER, NOT WITH A TEMPLATE.
   *
   * These two only ever reached the model inside
   * `TEMPLATE_STRUCTURE_PREAMBLE`, which was prepended to each composition
   * template's `layoutPrompt`. Briefed decks send no layoutPrompt, so deleting
   * the carousel registry took the ban on fabricated before/after pairs and the
   * ban on reproducing a reference's photograph out of every organic carousel —
   * silently, because a missing prohibition has no symptom until the model
   * happens to do the thing.
   *
   * It did. A healing-timeline cover came back as a BEFORE/AFTER pair of a real
   * client's brows; the quality gate flagged `fabricated-before-after`, sent a
   * correction, and logged "Defect survived the corrective re-render" three
   * times in one run — because the request it was correcting still contained no
   * rule against it.
   *
   * A before/after asserts an outcome the business may not have produced, using
   * a face the model invented. That is not a layout concern and must not depend
   * on which layout source a deck happens to use.
   */
  lines.push(RULE_NO_BEFORE_AFTER, RULE_NO_REFERENCE_PHOTOS);

  // THE PINNED PHOTO LEADS, AND IT OUTRANKS THE TOPIC.
  //
  // Stating the mandate once, in its natural place beside the other photo
  // rules, was not enough. Buried two thousand characters below "the subject
  // of this graphic is: Promote Haircut", it lost: an owner pinned a facial
  // photograph to a haircut service and the model returned an INVENTED
  // hairdressing scene — topically perfect, and not their picture. It had
  // resolved a contradiction it was never told how to resolve, and it guessed
  // that the words outrank the photograph.
  //
  // They do not. A service name is a database record; the photograph is the
  // owner standing in front of their own work saying "show this". So the
  // mandate goes FIRST, before any topic is mentioned, and it names the
  // conflict explicitly — otherwise the model resolves it silently and the
  // only evidence is an image the owner does not recognise.
  if (ownerPinnedPhoto) {
    lines.push(
      'FIRST AND ABOVE EVERYTHING ELSE: image 1 is a photograph the business chose for this graphic BY HAND. It must appear in the finished image, as the photographic subject. Reproduce THAT photograph — its people, place, clothing, equipment, colours and crop — do not redraw it, do not restage it, and do not generate a substitute. If it appears to have nothing to do with the topic named below, THE PHOTOGRAPH WINS: keep it and adapt the words and layout around it. Returning an invented image that suits the topic better is the single worst outcome here, and is a failed render.'
    );
  }

  // When refining an existing render, anchor to it so the change is surgical:
  // reproduce the previous version and apply ONLY what the user asked for.
  // This must come first so it frames the layout instructions that follow.
  // Wording comes from the intent table: `copy` pins the photography, `image`
  // pins the words. Sharing one sentence made whichever intent it did not
  // describe fight its own instruction.
  const amendment = amendmentDirective(intent);
  if (amendment) {
    lines.push(amendment);
  }

  if (templateMode) {
    // The template's layout is law. Reproduce it faithfully; change ONLY
    // colour/font/branding/copy. This stops the model improvising the layout.
    if (promptComponentEnabled('framing'))
      lines.push(
        hasInspirationImage
          ? `Recreate the provided inspiration image as a graphic for the business "${brand.name}". Copy its composition, structure, imagery STYLE, crops and text placement FAITHFULLY — it must be clearly the same design. Change ONLY the colours, fonts, branding and text. Do NOT abstract, simplify, geometric-ise, or reinterpret the layout.`
          : `Build a graphic for the business "${brand.name}" following EXACTLY the layout described below — same composition, structure, crops and text placement. Do NOT improvise or be creative with the structure.`
      );
    // Photo usage DEFERS to the layout: only the layouts that actually have a
    // photographic area get a photo. Type-only layouts (e.g. plain serif text
    // on cream) must stay text-only — never inject a photo into them.
    if (promptComponentEnabled('framing'))
      lines.push(
        buildTemplatePhotoInstruction(imageryKind, true, ownerPinnedPhoto)
      );
    if (promptComponentEnabled('subject'))
      lines.push(subjectContext(service, topic));
  } else {
    if (promptComponentEnabled('framing')) {
      lines.push(`Create a ${format} graphic for "${brand.name}".`);
    }
    if (promptComponentEnabled('subject'))
      lines.push(subjectContext(service, topic));
    /**
     * THE PHOTOGRAPH RULES ARE NOT A TEMPLATE FEATURE.
     *
     * `buildTemplatePhotoInstruction` carries `RULE_NO_PALETTE_FROM_PHOTO` and
     * `RULE_NO_TEXT_FROM_PHOTO`, and it was pushed only inside the templateMode
     * branch — so a render with no template never received either. That did not
     * matter while every organic graphic came through a template. Briefs made
     * this the ONLY branch organic takes, and the result was immediate: a deck
     * whose slides carried warm cream and peach AI-generated rooms came back
     * with cream and peach CANVASES, against a brand that works on pink, while
     * the deck anchor sat in the same prompt saying "match slide 1's
     * background". The anchor was not being ignored; it was being outvoted by a
     * large image with a strong ground and nothing saying not to sample it.
     *
     * The photograph is the SUBJECT. The palette belongs to the brand.
     */
    if (promptComponentEnabled('framing')) {
      lines.push(
        buildTemplatePhotoInstruction(imageryKind, false, ownerPinnedPhoto)
      );
    }
    if (imageryKind === 'none') {
      lines.push(
        'Use a clean, modern, typographic/abstract background — do not depict the treatment, people, or before/after imagery.'
      );
    }
  }

  /**
   * THE DECK'S GROUND, STATED AS A COLOUR AND SEPARATED FROM COMPOSITION.
   *
   * The nearest previous thing to this was `groundDirective`, which named a
   * CATEGORY — "this brand works on a PALE ground" — and sat inside the
   * `brandReferenceCount > 0` branch. Two problems, both observed. A category
   * is not a colour: two slides can each obey "pale" and come back cream and
   * pink. And the gating meant the 37 orgs with no brand corpus were told
   * nothing about the ground at all, which is most of where drift was measured.
   *
   * It also confused ground with layout — `photo-led` said "a photograph fills
   * most of the frame", which is a composition instruction wearing a colour
   * instruction's clothes. That is why a deck could not have both a full-bleed
   * cover and a coherent palette: choosing the bleed meant giving up the
   * ground.
   *
   * So this names a colour, applies to every slide whether or not the brand has
   * a corpus, and says explicitly that bleeding a photograph is still allowed.
   */
  if (args.deckGroundColour) {
    lines.push(
      `DECK GROUND: every slide of this set sits on ${args.deckGroundColour}. Use it for the flat areas of this slide — the field behind the type, panels, bars, margins and the space around a contained photograph — so this slide is unmistakably part of the same set. This says nothing about composition: a photograph may still bleed to all four edges if the slide calls for it, and when it does, the flat areas it still has (translucent bars, margins, panels over the photograph) take this colour. Do NOT substitute a different background colour, and do NOT take the ground from a photograph.`
    );
  }

  // Brand identity = the org's LOCKED style guide, applied identically to
  // every graphic (that's what keeps the whole batch consistent). The guide is
  // distilled once from the brand's own posts/colours/logo. We never sample a
  // per-graphic reference post for colour — that caused the red/blue drift.
  //
  // The PRIMARY colour, however, always comes from the org's live setting:
  // the guide is distilled once and never refreshed, so a palette baked into
  // it would silently override every later brand-colour change in settings
  // (ENG-493). Consistency across a batch is preserved — the live colour is
  // identical for every slide/graphic in the batch.
  // COLOUR COMES FROM THE BRAND'S OWN POSTS, NOT FROM A HEX IN PROSE.
  //
  // `primaryColor` is set for all 94 production orgs, which is the tell that it
  // is populated by default rather than chosen: 14 orgs sit on #7c3aed
  // (Tailwind violet-600), 8 on #7a00df and 12 on #000000 — about a third of
  // the estate on three generic values. The previous prompt declared that hex
  // "authoritative" and said it "takes precedence" over the example posts, so
  // for those orgs it instructed the model to override real evidence of the
  // brand with an app default. The distilled style guide had already laundered
  // the same default into prose ("#7c3aed (deep violet) as the dominant brand
  // colour") for orgs whose posts are nothing of the kind.
  //
  // With real references in hand the hex adds nothing and can only conflict, so
  // it is used ONLY when there is nothing to look at.
  if (brandReferenceCount > 0) {
    if (promptComponentEnabled('brand-example-line')) {
      lines.push(
        'Take the palette, typography, spacing and imagery treatment from the BRAND example posts — they are the brand. Do NOT adopt colours from the layout reference.'
      );
    }
    const ground = groundDirective(args.referenceColourway);
    if (ground && promptComponentEnabled('ground')) lines.push(ground);
    // GATED ON THE SCREENSHOT, NOT ON "IS THERE A LAYOUT".
    //
    // A curated screenshot IS a finished design, so a second design model
    // alongside it gives the model two to satisfy and it recomposes. Prose is
    // not: it names what sits on the slide and says nothing about how anything
    // looks, so it leaves the design model unopposed on exactly the axis the
    // design model owns. Gating this on `templateMode` meant the prose evicted
    // the brand's own posts as the design model — which is the whole reason
    // suppressing the prose ever looked like an improvement.
    if (!hasInspirationImage) {
      if (promptComponentEnabled('design-model'))
        lines.push(DESIGN_MODEL_DIRECTIVE);
      // No layout spec of any kind — the design model says what the brand looks
      // like, and nothing says how to ARRANGE a canvas. That gap is where the
      // overlapping text and floating photographs come from.
      if (!hasLayoutPrompt) lines.push(COMPOSITION_CRAFT_DIRECTIVE);
      // Both now ship together for the first time, and they overlap: the layout
      // spec fixes structure, the design model also speaks to canvas division
      // and photo treatment. Say which wins where, once, rather than leaving the
      // model to reconcile two directives that each sound absolute.
      if (hasLayoutPrompt && promptComponentEnabled('precedence')) {
        lines.push(
          'PRECEDENCE: where the layout description and the design model disagree about WHAT sits on this graphic or roughly where it sits, the layout description wins. Where they disagree about how it LOOKS — palette, typography, weight, density, texture, how a photograph is cropped and treated — the design model wins. Where the layout description is silent, follow the design model.'
        );
      }
    }
  } else {
    // No design model to copy, so the photograph needs generic composition
    // guidance. With a reference present this would compete with it.
    if (imageryKind !== 'none' && imageryKind !== 'model-invented') {
      lines.push(RULE_COMPOSE_THE_PHOTO);
    }
    // No design model AND no layout spec is the least-informed render there is.
    if (!hasLayoutPrompt) lines.push(COMPOSITION_CRAFT_DIRECTIVE);

    /**
     * NOT ON AN AMENDMENT — the prior image IS the palette.
     *
     * An amendment deliberately carries no brand example (`brandExample: false`
     * for `copy`/`image`/`branding` in INTENT_INPUTS), because the previous
     * render is the reference. That dropped it into this branch, which then
     * told the model to repaint in `primaryColor` ON A CLEAN NEUTRAL
     * BACKGROUND — flatly contradicting the "keep its existing branding
     * exactly" directive sitting in the same request.
     *
     * That is how a corrective re-render changed a deck's colours. The quality
     * gate rejects a slide for an unrelated defect (a drawn brand mark, a
     * truncated headline), the re-render repaints it neutral, and the deck now
     * has one slide in a different palette. Measured on one deck: 3 of 5 slides
     * went through this path.
     *
     * `primaryColor` is a poor thing to repaint TO in any case — it is a
     * default for much of the estate (14 orgs on Tailwind violet-600, 8 on
     * #7a00df, 12 on black), which is the same reason it is not trusted
     * elsewhere.
     */
    if (!inputsForIntent(intent).priorImage) {
      lines.push(
        `Use ${brand.primaryColor} as the brand colour on a clean neutral background; do not adopt colours from the layout reference.`
      );
    }
  }

  // Typography lock — one type system, applied identically across the whole
  // set. Placed with the brand-identity block so it frames the layout above.
  if (promptComponentEnabled('typography'))
    lines.push(
      buildTypographyDirective({
        hasFontReference,
        hasBrandExamples: brandReferenceCount > 0,
        isCarouselSlide,
      })
    );

  // Logo: use ONLY the provided brand logo (reproduced exactly); never invent
  // one or copy a logo from the layout/brand reference images. Re-typesetting
  // the business name in a random font (ENG-542) is explicitly forbidden.
  if (promptComponentEnabled('logo'))
    lines.push(
      logoSuppressed
        ? // A DELIBERATELY UNBRANDED SLIDE.
          //
          // Not every slide should carry the mark. Real brand carousels show it
          // on the cover and let the rest of the deck run clean, and each slide
          // that does carry it is another chance to render it wrong — one deck
          // was stamping it on all six. The cover keeps it, and because the cover
          // is also the anchor, it is the slide already inspected and re-rolled
          // before the others fan out.
          //
          // The logo images are withheld from this call as well, so this line is
          // a belt-and-braces against the model filling the gap with a wordmark
          // of its own invention.
          'This slide carries NO brand mark. Do NOT draw a logo, monogram, emblem, badge, crest, or the business name set as a logo or lockup anywhere on it — not in a corner, not as a watermark. A plain-text handle or website address in the footer is fine if the layout calls for one; a drawn mark is not. IGNORE/omit any logo, badge, icon or business name shown in ANY image you have been given — the brand example posts, the layout images, AND the earlier slide of this carousel if one was supplied. That earlier slide carries the mark deliberately; this one does not.'
        : hasLogo
          ? // THE EXAMPLES DECIDE WHICH LOGO; THE ASSET KEEPS IT CRISP.
            //
            // We store ONE logo per org, and that is a poorer model of reality than
            // it looks. Brands do not merely apply one mark two ways — several here
            // use genuinely DIFFERENT lockups per colourway. Martina Keelan PMU's
            // stored asset is a white wordmark reversed out of a mauve arch, while
            // her light-ground posts (28 of 70 designs) carry a bare mauve wordmark
            // with no arch at all.
            //
            // Told only "reproduce the asset exactly", the model had no way to know
            // which version this ground called for, so it improvised: a teal arch on
            // a brand with no teal, a circular badge with squashed letterforms, the
            // name re-typeset in plain sans.
            //
            // But dropping the asset and working from the examples alone is worse on
            // FIDELITY — measured over 14 paired renders, letterforms were right
            // 14/14 with the asset and 12/14 without (one distorted, one
            // re-typeset), because extracting a small mark from a busy post means
            // redrawing it. Hence: the examples pick the version, the asset keeps
            // the letterforms honest.
            //
            // THE ASSET IS THE ONLY SOURCE. The examples used to be allowed to
            // inform which lockup suited a given ground. On real data that is a
            // loophole, not a nuance: two of one org's three references carry
            // "Skin from Brazil / EXCLUSIVE PRODUCT" — their PRODUCT line — while
            // the uploaded asset is "Skin From Brazil / AESTHETICS", the clinic.
            // A reference can legitimately carry a different brand's mark, a
            // retired one, or a sub-brand's, and no instruction that lets the
            // examples "inform" the lockup can tell those apart. The asset is the
            // one thing the owner actually handed us.
            //
            // COLOUR IS NO LONGER NEGOTIABLE, and the reason is worth recording. An
            // earlier wording invited the model to match "the version the examples
            // use ... in different colourways", which read as licence to recolour
            // the mark. That licence was compounded by a real defect upstream:
            // `logo-variants` minted an opposite-polarity copy by RGB-inverting the
            // asset, which turned one org's gold #d2ac54 monogram into blue
            // #2d53ab and shipped it AS their logo. The minting is gone; this
            // sentence closes the matching hole in the prompt, and gives the model
            // the legitimate answer to a contrast problem — move the mark, or put a
            // plate behind it, never repaint it.
            'Use the brand\'s own logo. The provided brand LOGO image IS the mark: reproduce its letterforms, spelling, proportions AND COLOURS exactly. Never re-type the business name in a different font as a substitute for the logo, never invent a different mark, and never add or remove characters (no trailing "+", symbols, or taglines). NEVER RECOLOUR THE MARK — not to fit the background, not to match the palette, not to increase contrast. If the mark would not stand out where you were going to place it, move it to a part of the design where it does, or set it on a small plain plate of its own; changing its colours is never the answer. The LOGO image is the ONLY source for the mark. IGNORE every logo, wordmark, monogram, badge, icon or business name that appears in ANY other image you have been given — the BRAND example posts and the LAYOUT images alike. If a brand example shows a different mark, a different wordmark, a different container or a different colourway, it is NOT this brand\'s mark and must not influence what you draw. Never redraw a container shape in a colour, shape or size the LOGO image does not have, and never squeeze the mark to fit a shape it did not come in.'
          : // No logo asset reached us. This instruction has existed for a while and
            // was still losing, because the BRAND STYLE text above is injected from
            // `organization.brand_style_guide` — prose distilled from the org's real
            // posts "+ colours + logo" — and for some orgs it DESCRIBES the mark.
            // Camden Beauty Spa's reads "Gold is used exclusively for the logo
            // crown", "small gold crown/logo lockup at top centre" and "Every
            // graphic includes the logo", with no logo on file. Faced with a general
            // prohibition and a specific visual instruction, the model followed the
            // specific one and drew a crown — the same motif every time, freshly
            // redrawn every time, which is exactly what the owner reported.
            //
            // So the prohibition now names the conflict and states precedence
            // explicitly. A model cannot obey "include the logo" without a logo; it
            // has to be told that the style text is wrong on this point rather than
            // left to reconcile two rules.
            // The clause that used to sit here — "if the BRAND STYLE text above
            // describes a logo … IGNORE those instructions" — is gone with the
            // distilled prose it was arguing against. A prohibition that has to
            // out-argue a conflicting instruction in the same prompt is a weaker
            // guarantee than not carrying the instruction at all.
            'CRITICAL — NO LOGO IS AVAILABLE for this brand. Do NOT draw, render, or invent any logo, crest, emblem, crown, monogram, badge, or the business name set as a logo or lockup. Inventing one produces a false brand identity. Leave that space empty or use the layout\'s non-logo elements instead. Also IGNORE/omit any logo, badge, icon, or business name shown in the reference images (e.g. a "Messages"/inbox sticker or placeholder mark — never copy it).'
    );

  // The layout references are screenshots that still carry Instagram UI. Strip
  // it — that chrome (especially the dot pagination) is what reads as a
  // "carousel inside the image".
  lines.push(RULE_NO_SOCIAL_CHROME);

  // Canonical handle/URL: one exact string, so a multi-slide set never shows a
  // different handle per slide (ENG-542). Omit entirely when the org has none —
  // the model must not invent one.
  if (promptComponentEnabled('handle'))
    lines.push(
      brandHandle
        ? `If the layout has a handle, username, or website bar (typically at the bottom), render it EXACTLY as "${brandHandle}" — do not change its casing, invent a variant, or use a different domain, and use this same value wherever a handle/URL appears.`
        : 'If the layout has a handle, username, or website bar, leave it out entirely — do NOT invent or render any handle, username, or URL.'
    );

  // The user's explicit change request is the highest-priority instruction —
  // place it last so it overrides any conflicting default above.
  if (refinementInstruction?.trim()) {
    lines.push(
      `USER CHANGE REQUEST (highest priority — apply this exactly): ${refinementInstruction.trim()}`
    );
  }
  if (promptComponentEnabled('trailing'))
    lines.push(...args.trailingDirectives);
  return { directives: lines.filter(Boolean), copy: args.copy };
}

const generateBrandedGraphicImpl = async (
  db: DbConnection,
  input: GenerateBrandedGraphicInput,
  /**
   * How many content-refusal rotations have already been spent. Bounds the
   * recursion: rotations first, then one text-only attempt, then give up.
   */
  refusalAttempt = 0
): Promise<Result<GenerateBrandedGraphicOutput>> => {
  const parsed = generateBrandedGraphicSchema.safeParse(input);
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
    model,
    allowAiImages,
    sourceAssetIds,
    graphicId,
    templateSlug,
  } = parsed.data;
  // The four imagery booleans are folded into ONE named policy here, and
  // nothing below reads them again. `suppressSubjectPhoto` is not part of it:
  // that is a per-slide layout fact (a brand card has no photographic area),
  // not an org-level preference, and it is applied at the resolve call.
  const imageryPolicy =
    parsed.data.imageryPolicy ??
    imageryPolicyFromLegacyFlags({
      allowAiImages,
      allowStockImages: parsed.data.allowStockImages,
    });

  // ── Brand + service lookups ──────────────────────────────────────────
  const [orgRow] = await db
    .select({
      name: organization.name,
      logo: organization.logo,
      brandFontImageUrl: organization.brandFontImageUrl,
      brandStyleGuide: organization.brandStyleGuide,
      primaryColor: organization.primaryColor,
      websiteUrl: organization.websiteUrl,
      chatbotSettings: organization.chatbotSettings,
    })
    .from(organization)
    .where(and(eq(organization.id, organizationId), notDeleted(organization)))
    .limit(1);
  if (!orgRow) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }
  const brand: OrgBrand = {
    name: orgRow.name,
    logo: orgRow.logo ?? null,
    fontImageUrl: orgRow.brandFontImageUrl ?? null,
    primaryColor:
      parsed.data.brandPrimaryColor ?? orgRow.primaryColor ?? '#6366f1',
  };

  // ONE canonical footer handle for the org, identical across every carousel
  // slide (ENG-542). Explicit override → IG handle → website domain → none.
  const brandHandle = deriveBrandHandle({
    override: parsed.data.brandHandle,
    instagramLink: orgRow.chatbotSettings?.instagramLink ?? null,
    websiteUrl: orgRow.websiteUrl ?? null,
  });

  const [svcRow] = await db
    .select({
      name: organizationService.name,
      description: organizationService.description,
      targetArea: organizationService.targetArea,
    })
    .from(organizationService)
    .where(eq(organizationService.id, serviceId))
    .limit(1);
  if (!svcRow) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }
  const service: ServiceInfo = svcRow;

  // Assemble the input images as an ORDERED manifest: each carries a role
  // string so the prompt can tell the model what each image is (with 3-4
  // images, an unlabelled blob is ambiguous — it can't tell font ref from
  // logo from subject).
  const inputs: { img: GeminiImageInput; role: string }[] = [];

  // ── PRIOR VERSION: the previous render for refinement-aware regen ─────
  // When the user re-rolls with an instruction we anchor to the last render so
  // the change is surgical (see buildPrompt's hasPriorImage branch).
  let hasPriorImage = false;
  /**
   * BYTES BEAT A URL when the caller already holds them.
   *
   * An amendment fetches the previous render back from S3, which is right for a
   * user re-roll. A deck built slide by slide holds its siblings in memory and
   * has not uploaded them yet, so a URL would mean storing a slide purely to
   * hand it straight back to the next call.
   */
  if (parsed.data.priorImageBase64) {
    inputs.push({
      img: {
        data: parsed.data.priorImageBase64,
        mediaType: parsed.data.priorImageMediaType ?? 'image/png',
      },
      role:
        parsed.data.regenerationIntent === 'sibling'
          ? 'a FINISHED SLIDE of this same carousel — copy its background, palette and type treatment; this slide has its own copy and its own photograph'
          : 'the PREVIOUS version of this graphic — reproduce its layout, composition, branding and fonts faithfully and change ONLY what the user requests',
    });
    hasPriorImage = true;
  } else if (parsed.data.priorImageUrl) {
    const priorImg = await fetchImageAsInput(parsed.data.priorImageUrl);
    if (!priorImg) {
      // Without the prior render the model has nothing to edit and produces a
      // brand-new graphic, so the owner's change request silently becomes a
      // full re-roll. Never let that pass unnoticed again.
      logger.warn(
        'Prior image could not be loaded — regeneration will re-roll',
        {
          organizationId,
          serviceId,
          graphicId,
          priorImageUrl: parsed.data.priorImageUrl,
        }
      );
    }
    if (priorImg) {
      inputs.push({
        img: priorImg,
        role: 'the PREVIOUS version of this graphic — reproduce its layout, composition, branding and fonts faithfully and change ONLY what the user requests',
      });
      hasPriorImage = true;
    }
  }

  // What is this render CHANGING? One decision, made once — the inputs below
  // follow from it via `inputsForIntent`, so tuning one intent cannot silently
  // disable another (see regeneration-intent.ts).
  const intent: RegenerationIntent =
    parsed.data.regenerationIntent ??
    inferRegenerationIntent({
      hasPriorImage,
      explicitSourceAssetIds: sourceAssetIds,
      refinementInstruction: parsed.data.refinementInstruction,
    });
  const wants = inputsForIntent(intent);

  // ── SUBJECT imagery ──────────────────────────────────────────────────
  // Resolved ONCE, under one named policy, and kept as a tagged union so the
  // prompt can say truthfully what it is holding.
  // Kept for logo-contrast detection — the subject photo is the slide's
  // background on full-bleed layouts.
  let subjectBase64: string | null = null;
  // Brand/text CTA slides opt out of the real subject photo: the layout has no
  // photographic area, and pushing the org's real media (often the owner's
  // headshot) would let the model drop it into the slide as a "portrait".
  // Suppressing covers the stock tier too — the whole resolve is skipped.
  // On an amendment the previous version already CONTAINS the subject imagery.
  // Re-supplying the source photo invites the model to re-compose around it
  // instead of editing what is there — the competing-reference problem that
  // makes "change one word" shift the picture.
  // PIN the photo on an amendment.
  //
  // `resolveSlotImage` picks by least-recently-used rotation, so re-resolving
  // during an edit returns a DIFFERENT photo than the one in the prior render —
  // and the model, handed a prior image and a conflicting "real service photo",
  // re-composes around the newcomer. That is how "add the logo to slide 7"
  // returned the same words over a stock dental surgery, for a beauty clinic.
  //
  // So when this render is amending something and the caller has not named its
  // own assets, reuse whatever the PRIOR render actually chose — recorded on
  // its provenance row. Falls back to a normal resolve when there is no record
  // (renders that predate provenance, or a source that never had a photo).
  const pinnedAssetIds =
    hasPriorImage && !sourceAssetIds?.length && parsed.data.priorGraphicId
      ? await findPriorChosenAssetIds(db, {
          graphicId: parsed.data.priorGraphicId,
          slideIndex: parsed.data.slideIndex,
        })
      : undefined;
  const effectiveSourceAssetIds = sourceAssetIds?.length
    ? sourceAssetIds
    : pinnedAssetIds;

  const slot =
    parsed.data.suppressSubjectPhoto || !wants.subjectPhoto
      ? { success: false as const }
      : await resolveSlotImage(db, {
          organizationId,
          targetServiceId: serviceId,
          prompt: topic,
          bbox: CANVAS,
          // The AI tier used to be pinned off here, which made "allow AI
          // images" unable to affect anything but prompt prose while stock
          // answered first regardless. The policy decides now.
          policy: imageryPolicy,
          sourceAssetIds: effectiveSourceAssetIds,
          rotationSalt: parsed.data.slotRotationSalt,
          preferStock: parsed.data.preferStockImage,
          usedAssetIds: parsed.data.excludeAssetIds,
          referenceColourway: parsed.data.referenceColourway,
        });
  // Captured for provenance so "why did it use that photo?" is answerable.
  const slotDecision = slot.success ? slot.data : null;
  // DEBUG_SLOTS=1 prints, per slide, which image was chosen and from which
  // tier. "Why is the same photo on three slides?" is otherwise answerable
  // only by eye, and counting tiles in a contact sheet has been wrong twice.
  if (process.env.DEBUG_SLOTS) {
    console.log(
      `[slot] slide=${parsed.data.slideIndex ?? '-'} ` +
        `preferStock=${parsed.data.preferStockImage ?? false} ` +
        `salt=${parsed.data.slotRotationSalt ?? '-'} ` +
        `sourceAssetIds=${(effectiveSourceAssetIds ?? []).join(',') || '-'} ` +
        `→ source=${slotDecision?.source ?? 'none'} ` +
        `asset=${slotDecision?.consumedAssetId?.slice(0, 8) ?? '-'} ` +
        `stock=${slotDecision?.consumedStockClipId?.slice(0, 8) ?? '-'}`
    );
  }
  // The resolved source keeps its provenance. It used to collapse to
  // `usedServiceMedia: boolean` right here, which is how a curated stock still
  // came to be described to the model as the client's own photograph.
  let imagery: ImagerySource = slot.success
    ? slot.data.imagery
    : { kind: 'none' };

  // The POLICY is the authority on whether invented imagery is allowed, not
  // the leaf that failed to find a photograph. Reconciling here means a
  // resolve that errored, was skipped for a text-only slide, or simply found
  // nothing all land in the same place.
  if (imagery.kind === 'none' && policyAllowsAi(imageryPolicy)) {
    imagery = { kind: 'model-invented' };
  }

  // Did the OWNER choose this photograph, or did the resolver find it for them?
  // `sourceAssetIds` and not `effectiveSourceAssetIds`: the latter also carries
  // ids inherited from a prior render's provenance, which nobody picked on this
  // call and which must keep deferring to the layout as they always have.
  const ownerPinnedPhoto =
    Boolean(sourceAssetIds?.length) && imagery.kind === 'org-asset';

  // NO SILENT CAPS.
  //
  // One render attaches exactly ONE subject photo, so every id past the chosen
  // one is discarded here. That was invisible: no warning, no field, nothing —
  // an owner who picked ten photographs got a graphic built from one of them
  // and no way to learn that the other nine were dropped rather than weighed.
  // The picker now preselects one, but it still ALLOWS more (a carousel spends
  // them one per slide), so the drop has to be able to say so out loud.
  if (sourceAssetIds && sourceAssetIds.length > 1) {
    logger.warn('More subject images selected than this render can use', {
      event: 'content.subject_images_dropped',
      organizationId,
      selectedCount: sourceAssetIds.length,
      usedAssetId: slotDecision?.consumedAssetId ?? null,
      droppedAssetIds: sourceAssetIds.filter(
        (id) => id !== slotDecision?.consumedAssetId
      ),
    });
  }

  // The owner named photographs and NONE of them reached the model — the ids
  // resolved to nothing, or the bitmap fetch failed. The render still succeeds
  // (on stock, invented, or bare type), so this is precisely the failure an
  // owner reports as "it ignored my picture" and the logs used to deny.
  if (sourceAssetIds?.length && !ownerPinnedPhoto) {
    logger.warn('Owner-selected images did not reach the model', {
      event: 'content.subject_images_unused',
      organizationId,
      selectedCount: sourceAssetIds.length,
      selectedAssetIds: sourceAssetIds,
      fellBackTo: imagery.kind,
    });
  }

  if (sourceSuppliesImage(imagery)) {
    const subject = await fetchImageAsInput(imagery.url);
    if (subject && promptComponentEnabled('photo')) {
      inputs.push({
        img: subject,
        role: subjectPhotoRole(imagery, ownerPinnedPhoto),
      });
      subjectBase64 = subject.data;
    } else {
      // The bitmap could not be fetched, so there is no image after all.
      // Saying otherwise would leave the prompt instructing the model to place
      // a photograph it was never given.
      imagery = policyAllowsAi(imageryPolicy)
        ? { kind: 'model-invented' }
        : { kind: 'none' };
    }
  }

  // NOW MEANS WHAT IT ALWAYS SAID. The field is documented "true when the
  // SUBJECT came from real uploaded service media", and it was set for a stock
  // library still too — so the "generated with no real service media" warning
  // below stayed silent for exactly the case customers complain about ("only
  // use real pictures of me"), and provenance recorded stock as the org's own.
  const usedServiceMedia = sourceIsAuthentic(imagery);

  let referenceCount = 0;
  const layoutPrompt = parsed.data.layoutPrompt;

  // ── LAYOUT reference (curated template) ──────────────────────────────
  // A curated template inspiration image is the LAYOUT to reproduce (rebranded).
  // Skipped on an amendment: the PREVIOUS version is the layout now. Handing
  // over the original inspiration as well gives the model two competing
  // structures to satisfy, and it resolves that by re-composing — which is
  // exactly what a one-word edit must not do.
  if (parsed.data.inspirationImageBase64 && wants.layoutInspiration) {
    inputs.push({
      img: {
        data: parsed.data.inspirationImageBase64,
        mediaType: parsed.data.inspirationMediaType ?? 'image/jpeg',
      },
      role: 'the LAYOUT reference — reproduce its structure/composition/crops FAITHFULLY, fully rebranded (do NOT copy its colours, branding, logo or text)',
    });
  }

  // ── BRAND visual references (the org's own posts) ────────────────────
  // Show the model a SET of the brand's real posts so it can see the visual
  // SYSTEM rather than one instance of it. These carry the palette, typography
  // and logo treatment — there is no distilled prose style guide any more,
  // because that prose competed with the real logo PNG and the template it was
  // meant to describe.
  // Resolved by the CALLER, never here. Both entry points (single and carousel)
  // resolve the set once and hand the same one down, so every graphic in a
  // render shares its references; resolving per-graphic would reintroduce the
  // drift this replaced, and would hide a database read inside a leaf service.
  const brandRefUrls = parsed.data.styleReferenceUrls ?? [];
  // Skipped on an amendment — the previous version already embodies the
  // brand's aesthetic, and a second "match this feel" reference just gives the
  // model licence to restyle.
  if (brandRefUrls.length > 0 && wants.brandExample) {
    const resolved = await Promise.all(
      brandRefUrls.map(async (stored) =>
        fetchImageAsInput(await resolveReferenceImageUrl(stored))
      )
    );
    const loaded = resolved.filter(
      (img): img is NonNullable<typeof img> => img !== null
    );

    // SAY WHEN A REFERENCE DOES NOT LOAD.
    //
    // This was an `if (img)` with no `else`, and it concealed a total outage:
    // the corpus stored Meta CDN URLs that expire in about a week, nothing
    // refreshed them, and 99.3% of production rows had gone dead. Generation
    // silently fell back to "no brand reference" for months, and the only
    // symptom anyone could see was owners reporting that their branding kept
    // changing.
    if (loaded.length < brandRefUrls.length) {
      logger.warn('Some brand references could not be loaded', {
        event: 'content.brand_reference_unloadable',
        organizationId,
        requested: brandRefUrls.length,
        loaded: loaded.length,
      });
    }

    for (const [i, img] of promptComponentEnabled('brand-examples')
      ? loaded.entries()
      : [].entries()) {
      inputs.push({
        img,
        role:
          i === 0
            ? parsed.data.inspirationImageBase64
              ? "a BRAND example post — match the brand's visual aesthetic/feel/typography; do NOT use it for layout"
              : "the DESIGN MODEL for this graphic — the business's own post. Build in the same design language: the way it divides the canvas, its hierarchy and the scale relationships between headline, body and mark, how dense or airy it is, how it treats a photograph, and its decorative devices. Do NOT copy its words or its photograph"
            : "another BRAND example post from the same set — treat these together as the brand's visual system, and keep whatever is consistent between them",
      });
    }
    referenceCount = loaded.length;

    /**
     * THE PALETTE AS A PICTURE — OFF BY DEFAULT, and here is why.
     *
     * The idea: an org's references are frequently all `photo-led`, and a
     * photo-led post has no ground to teach, so nothing in the request says
     * what the background should be and the model invents one per generation.
     * The colours ARE in the references, just not compositionally, so
     * flat-gated extraction pulls them out and hands them back as an image —
     * the channel this model obeys, since a hex in prose never worked (§16).
     *
     * On one org that was a large win: deck ground spread 174 -> 22 median,
     * distance from the brand's colour 134 -> 14, over three runs per arm.
     *
     * ON A SECOND ORG IT MADE THINGS WORSE — 122 -> 216 — and the reason
     * generalises badly. Re-run with a hand-verified CORRECT palette, that org
     * still ignored it: one deck landed on the declared blush (Δ7), one
     * scattered, and one rendered a perfectly coherent deck (spread 26) in a
     * dark brown 271 away from the swatch — a brown matching the DESIGN MODEL
     * reference almost exactly.
     *
     * So the swatch does not OVERRIDE the references, it REINFORCES them. It
     * won on the first org because its references were silent about the ground
     * rather than opposed to it; where a reference states a ground, that wins.
     * The dose-response that seemed to prove control (a navy present in no
     * reference, reproduced 4/4) only ever proved the swatch beats SILENCE.
     *
     * The lever is therefore WHICH reference becomes the design model, not what
     * a swatch declares alongside it. Left in place, off, because the
     * measurement harness and §17 are worth keeping and the primitives are used
     * by the deck-colour re-roll — which is org-independent and stays on.
     */
    const overrideGround = process.env.BRAND_SWATCH_GROUND;
    const palette = !process.env.ENABLE_BRAND_SWATCH
      ? null
      : overrideGround
        ? {
            ground: overrideGround,
            accents: (process.env.BRAND_SWATCH_ACCENTS ?? '')
              .split(',')
              .filter(Boolean),
          }
        : await readBrandPalette(
            loaded.map((img) => Buffer.from(img.data, 'base64'))
          );
    if (palette && promptComponentEnabled('swatch')) {
      inputs.push({
        img: {
          data: (await buildPaletteSwatch(palette)).toString('base64'),
          mediaType: 'image/png',
        },
        role: PALETTE_SWATCH_ROLE,
      });
      logger.info('Palette swatch attached', {
        organizationId,
        ground: palette.ground,
        accents: palette.accents,
      });
    }
  } else if (wants.brandExample) {
    // Zero references is a legitimate state for a brand-new org and a
    // reportable one for an established org whose corpus never got built.
    logger.warn('Generating with NO brand reference', {
      event: 'content.no_brand_reference',
      organizationId,
    });
  }

  // ── DECK ANCHOR ──────────────────────────────────────────────────────
  // Slide 1 of this same carousel, already rendered. Stated as a hard
  // constraint rather than another example: the brand references say what the
  // BRAND looks like, this says what THIS DECK looks like, and only one deck
  // can be right.
  if (parsed.data.deckAnchorBase64 && promptComponentEnabled('anchor')) {
    inputs.push({
      img: {
        data: parsed.data.deckAnchorBase64,
        mediaType: parsed.data.deckAnchorMediaType ?? 'image/png',
      },
      role: parsed.data.suppressLogo
        ? // THE ANCHOR CONTAINS THE MARK, so "match it exactly" and "draw no
          // mark" contradict each other, and the model resolved that by
          // copying the logo onto slides that were meant to carry none.
          // Withholding the logo IMAGE cannot fix this — the mark is inside
          // the anchor. The carve-out has to be explicit, and stated here
          // rather than only in the no-mark line, because this instruction is
          // the more specific of the two and wins on its own.
          'slide 1 of THIS SAME carousel, already rendered — match its background colour and pattern, its accent colour, its display and body typefaces at the same relative sizes, THE SAME TYPE TREATMENT — if slide 1 sets its display line solid then set yours solid, if it sets it as a hollow outline then set yours as a hollow outline, and likewise for knocked-out or shadowed type — and its margins. The COPY and any PHOTOGRAPH are expected to be DIFFERENT — this slide has its own, and reusing the photo from slide 1 is a defect, not a match. ONE FURTHER EXCEPTION: slide 1 carries the brand mark and THIS slide must NOT. Do not copy the logo, wordmark or business-name lockup from it — leave that area clear. Otherwise do NOT introduce a background treatment, colour or decorative motif that is not already in that slide.'
        : 'slide 1 of THIS SAME carousel, already rendered — match it EXACTLY: the same background colour and pattern, the same accent colour, the same display and body typefaces at the same relative sizes, THE SAME TYPE TREATMENT — solid, hollow outline, knocked-out or shadowed, whichever slide 1 uses for its display line — and the same margins. Only the copy and any photograph may differ. Do NOT introduce a background treatment, colour or decorative motif that is not already in that slide',
    });
  }

  /**
   * ── FONT reference ──────────────────────────────────────────────────
   *
   * ONLY SENT WHEN A LAYOUT IS COMPETING WITH IT.
   *
   * `brand_font_image_url` is named as a type specimen and is, for most orgs, a
   * finished post — one is the owner photographed on a sofa with her wordmark
   * and "Salon owner & founder" set over it. On a briefed deck there is no
   * layout, so that picture is the most concrete thing in the request and the
   * model builds from it: slides came back carrying her photograph and
   * reprinting "Meet Martina — Salon owner & founder, Martina Keelan PMU" as
   * slide copy.
   *
   * TWO WORDINGS FAILED BEFORE THIS GATE. Introducing it as "a FONT reference —
   * render ALL text in the typeface shown here" said nothing about the rest of
   * the picture. Replacing that with an explicit prohibition — read the
   * letterforms, its photograph and wording are off limits — did not hold
   * either: the same sentence came back on the next render. A probe that showed
   * no effect from this image had a detailed layout brief in it, which is what
   * was actually holding the line, and briefed decks have none.
   *
   * So it goes only where something else defines the composition — an ad, which
   * pins its layout. Nothing is lost for briefed work: the deck ground already
   * reads this file's palette in `resolveDeckGround` without showing it to the
   * model, and typography comes from the brand's own posts.
   */
  let hasFontReference = false;
  if (brand.fontImageUrl && Boolean(layoutPrompt)) {
    try {
      const fontUrl = await resolveReferenceImageUrl(brand.fontImageUrl);
      const fontImg = await fetchImageAsInput(fontUrl);
      if (fontImg) {
        inputs.push({
          img: fontImg,
          /**
           * THE FILE IS NOT A TYPE SPECIMEN, AND SAYING SO STOPPED MATTERING.
           *
           * `brand_font_image_url` is described as a font reference and used to
           * be introduced as one — "render ALL text in the typeface shown here"
           * — with nothing said about the rest of the picture. For most orgs
           * the file is a FINISHED POST: one is the owner photographed on a
           * sofa in a cream room, with her wordmark and "Salon owner &
           * founder" set over it.
           *
           * On a briefed deck the model has no layout to satisfy, so that
           * picture is the most concrete thing in the request and it gets
           * reproduced. Observed on a myths deck: two of five slides came back
           * carrying that photograph, and one reprinted "Salon owner &
           * founder, Martina Keelan PMU" as slide copy.
           *
           * A probe with a detailed layout brief showed no effect from this
           * image, which is true and irrelevant — the brief was competing with
           * it. Nothing competes with it now, so the prohibition has to be
           * explicit, and it has to name CONTENT rather than palette: the
           * defect is a copied photograph and a copied sentence, not a sampled
           * colour.
           */
          role: 'a TYPE SPECIMEN — read the LETTERFORMS from it and render all text in that typeface. Everything else in this image is off limits: do NOT reproduce its photograph, its subject, its room, its wording, its logo or its layout, and do NOT treat it as a design to imitate. Nothing pictured in it may appear in the graphic you produce.',
        });
        hasFontReference = true;
      }
    } catch {
      // font ref is best-effort; the style reference still carries typography
    }
  }

  // ── LOGO ─────────────────────────────────────────────────────────────
  // Pass the REAL logo as a lossless PNG input and instruct the model to
  // reproduce it 1:1. A single stored logo only contrasts with half the
  // backgrounds it lands on (a white wordmark vanishes on a cream slide and
  // reads as a near-blank image to the model, which then re-typesets the name
  // in a random font). So we keep BOTH polarities and hand this slide the one
  // that contrasts with ITS background.
  let hasLogo = false;
  // Slides that do not carry the mark are never SHOWN it. Withholding the image
  // is stronger than instructing against it: the model cannot reproduce a mark
  // it has not seen, so the failure mode collapses from "wrong lockup" to
  // "no lockup", which is the one we can live with.
  const suppressLogo = parsed.data.suppressLogo === true;

  // The carousel orchestrator resolves both polarities ONCE and passes them
  // down; standalone graphics resolve them here. Either way it's the same
  // light/dark pair (the inverted copy is minted + cached in S3 once).
  const variants: LogoVariants = suppressLogo
    ? { light: null, dark: null }
    : parsed.data.logoLightBase64 || parsed.data.logoDarkBase64
      ? {
          light: parsed.data.logoLightBase64
            ? {
                data: parsed.data.logoLightBase64,
                mediaType: parsed.data.logoLightMediaType ?? 'image/png',
              }
            : null,
          dark: parsed.data.logoDarkBase64
            ? {
                data: parsed.data.logoDarkBase64,
                mediaType: parsed.data.logoDarkMediaType ?? 'image/png',
              }
            : null,
        }
      : await ensureLogoVariants(db, organizationId);

  if (variants.light || variants.dark) {
    // Estimate this slide's FINAL background tone to pick the contrasting logo
    // polarity. Use ONLY the real subject photo (which becomes the slide's
    // background on full-bleed layouts). We deliberately do NOT read the
    // inspiration image here: it's the PRE-rebrand reference screenshot (often a
    // dark portrait), so its tone made us pick a light logo for a slide that
    // rebrands to a light background — the logo then vanished and the model
    // re-typeset the business name (ENG-542). With no subject photo we assume a
    // light/neutral background (the default for text/brand slides) and hand over
    // the dark logo. Dark bg → light logo, and vice versa.
    const bgSignal = subjectBase64;
    const bgLuminance = bgSignal ? await imageLuminanceFromBase64(bgSignal) : 1;
    const logoImg = pickLogoForBackground(variants, bgLuminance);
    if (logoImg) {
      inputs.push({
        img: logoImg,
        role: 'the brand LOGO — reproduce it EXACTLY as given (do not redraw, restyle, recolour, re-letter, or alter its proportions); place it tastefully where the layout puts the logo, at a sensible size',
      });
      hasLogo = true;
    }
  }

  // 35% of orgs have no logo on file, and `ensureLogoVariants` returns empty
  // for that case with no log line — which is why "the logo keeps changing"
  // was never traceable. Record which of the two it was.
  const logoOutcome = hasLogo
    ? ('used' as const)
    : brand.logo
      ? ('missing-fetch-failed' as const)
      : ('missing-no-logo' as const);

  const images = inputs.map((i) => i.img);
  const format = parsed.data.format ?? 'social media post';
  const manifest =
    inputs.length > 0
      ? ` Provided images, in order — ${inputs
          .map((p, i) => `image ${i + 1} is ${p.role}`)
          .join('; ')}.`
      : '';
  // An org with no logo on file is a DATA problem wearing the costume of a
  // rendering problem: the model has nothing to reproduce, so it invents a mark,
  // and the owner reports that their logo keeps changing. Worth reporting on its
  // own — this used to be gated behind the distilled style guide mentioning a
  // logo, which meant it only fired for orgs that happened to have one written.
  if (!hasLogo && !suppressLogo) {
    logger.warn('Generating with no brand logo on file', {
      event: 'content.brand_asset_gap',
      organizationId,
    });
  }

  const layoutLine = layoutPrompt ?? '';
  const slideLine = parsed.data.slideDirective ?? '';
  const templateMode = Boolean(
    parsed.data.inspirationImageBase64 || layoutPrompt
  );
  const graphicPrompt = buildPrompt({
    brand,
    service,
    topic,
    intent,
    format,
    imageryKind: imagery.kind,
    ownerPinnedPhoto,
    templateMode,
    hasInspirationImage: Boolean(parsed.data.inspirationImageBase64),
    hasLayoutPrompt: Boolean(layoutPrompt),
    deckGroundColour: parsed.data.deckGroundColour,
    hasLogo,
    logoSuppressed: suppressLogo,
    hasFontReference,
    brandReferenceCount: referenceCount,
    isCarouselSlide: parsed.data.isCarouselSlide ?? false,
    brandHandle,
    refinementInstruction: parsed.data.refinementInstruction,
    // The layout description, the slide's position/role and the input
    // manifest are all instructions ABOUT the render, so they belong in the
    // directive channel — never beside the words to be drawn.
    trailingDirectives: [layoutLine, slideLine, manifest],
    copy: parsed.data.renderCopy ?? null,
  });
  const prompt = serialiseGraphicPrompt(graphicPrompt);

  // DEBUG_GRAPHIC_PROMPT=1 prints the exact prompt and the image inputs.
  // Every attempt to make the references win had been a reword of ONE line in
  // a prompt nobody had ever read end to end.
  if (process.env.DEBUG_GRAPHIC_PROMPT) {
    console.log(
      `\n===== PROMPT (${prompt.length} chars, ${inputs.length} images) =====\n${prompt}\n===== INPUTS =====\n${inputs
        .map((i, n) => `  [${n}] ${i.role}`)
        .join('\n')}\n===== END =====\n`
    );
  }

  // Structured, not interpolated: these are the inputs that decide whether a
  // graphic comes out right, so each must be a QUERYABLE FIELD. This was a
  // `console.log`, which bypasses the Pino/Logtail wrapper entirely — it
  // produced zero BetterStack entries in 21 days, which is why "was the logo
  // even sent?" was unanswerable.
  logger.info('Generating branded graphic', {
    organizationId,
    serviceId,
    graphicId,
    /**
     * WHICH SLIDE THIS IS.
     *
     * Absent, so every render of a deck logged identically and rows could only
     * be bound to positions by their order in the file — which is not order at
     * all when slides fan out concurrently. "Why did slide 4 drift" was
     * unanswerable from the logs for exactly that reason.
     */
    slideIndex: parsed.data.slideIndex ?? null,
    templateSlug,
    templateMode,
    // The two that drive most complaints: no logo => the model invents a
    // wordmark; no service media => it invents the subject imagery.
    hasLogo,
    logoOutcome,
    // True when this render EDITS a previous version rather than composing
    // fresh. On an amendment the competing layout/brand/subject references are
    // deliberately withheld, so `inputImageCount` should be small — if it
    // isn't, something is still inviting the model to re-compose.
    isAmendment: hasPriorImage,
    usedServiceMedia,
    mediaSource: toProvenanceMediaSource(
      slotDecision?.source,
      sourceAssetIds,
      imagery.kind
    ),
    chosenAssetId: slotDecision?.consumedAssetId,
    candidateCount: slotDecision?.candidateAssetIds?.length ?? 0,
    // Pool size is the honest variety signal: 1 means every graphic for this
    // service must reuse the same photo, whatever rotation does.
    rotationPoolSize: slotDecision?.rotationPoolSize ?? 0,
    excludedForQuality: slotDecision?.excludedForQuality ?? 0,
    hasInspirationImage: Boolean(parsed.data.inspirationImageBase64),
    hasLayoutPrompt: Boolean(layoutPrompt),
    brandReferenceCount: referenceCount,
    inputImageCount: images.length,
    model,
  });

  // Generate natively at 4:5 so we never have to crop the model's output
  // (cropping slices off headers/edges — see the cropped-preview bug).
  const gen = await callGeminiImage({
    model,
    prompt,
    images,
    aspectRatio: '4:5',
  });
  if (!gen.success) {
    // A `no_image_part` outcome (surfaced as AI_MODEL_REFUSED) is a transient
    // soft-refusal: callGeminiImage already re-prompted a few times, and the
    // BullMQ job will retry the whole render. Don't page Sentry on a recoverable
    // condition — warn locally and let the exhausted-retries path (final job
    // failure) be the thing that escalates. Genuinely terminal failures
    // (network/http/blocked) still go to Sentry via logError.
    if (gen.error.code === ErrorCodes.AI_MODEL_REFUSED) {
      console.warn(
        `[branded-graphic] org=${organizationId} service=${serviceId} model returned no image part (recoverable, will be retried): ${gen.error.message}`
      );
    } else {
      logError('imageGeneration.generateBrandedGraphic.model', gen.error, {
        feature: 'image-generation',
        extra: { organizationId, serviceId, usedServiceMedia, referenceCount },
      });
    }
    /**
     * A CONTENT REFUSAL IS DETERMINISTIC — DROP THE PHOTOGRAPH AND RE-ASK.
     *
     * Retrying identical inputs cannot work: the same request is refused every
     * time. It was classified "recoverable", so it was re-sent inside the call
     * and then the whole deck was re-rendered by the job — four complete
     * recomposes, ~28 image calls, no output.
     *
     * The PHOTOGRAPH is the trigger, not the copy. Verified twice against
     * production: a body-contouring still on a body-contouring topic is refused
     * with `PROHIBITED_CONTENT`, and the identical render succeeds first time
     * with the subject suppressed. It is not rare, either — a single local run
     * of one deck and two singles hit it six times, so the whole SERVICE is
     * effectively un-illustrable by the model.
     *
     * This lives HERE rather than in the callers because every path has to be
     * covered: the two carousel routes, singles, and regeneration. It was first
     * written in the carousel's template path, and the very next run went down
     * the corpus path and dropped four slides that this would have saved.
     */
    if (
      gen.error.code === ErrorCodes.AI_MODEL_REFUSED &&
      sourceSuppliesImage(imagery) &&
      refusalAttempt < MAX_REFUSAL_ROTATIONS
    ) {
      /**
       * TRY THE NEXT PHOTOGRAPH BEFORE GIVING UP ON PHOTOGRAPHY.
       *
       * A safety block is specific to the IMAGE, not the subject: on one
       * body-contouring service the model refuses a bare-midriff still and
       * accepts a legs-on-a-studio-floor still from the same pool, on the same
       * topic. So the refused asset is excluded and the slot re-resolved.
       *
       * This started as a straight drop to `text-led`, which did stop the
       * failures — and turned a batch into eighteen graphics carrying two
       * photographs between them, because every refusal removed imagery from
       * that slide for good. Trading a failure for a blank is not a fix.
       */
      const refusedAssetId = slotDecision?.consumedAssetId;
      const excluded = [
        ...(parsed.data.excludeAssetIds ?? []),
        ...(refusedAssetId ? [refusedAssetId] : []),
      ];
      logger.warn('Refused on content safety — trying another photograph', {
        event: 'content.refusal_retry_next_asset',
        organizationId,
        serviceId,
        graphicId,
        slideIndex: parsed.data.slideIndex ?? null,
        attempt: refusalAttempt + 1,
        refusedAssetId: refusedAssetId ?? null,
        excludedSoFar: excluded.length,
      });
      return generateBrandedGraphicImpl(
        db,
        { ...input, excludeAssetIds: excluded, sourceAssetIds: undefined },
        refusalAttempt + 1
      );
    }
    if (
      gen.error.code === ErrorCodes.AI_MODEL_REFUSED &&
      refusalAttempt < MAX_REFUSAL_ROTATIONS + 1
    ) {
      // The pool is exhausted (or there was never a photograph). Only NOW is
      // text-only the right answer. `text-led` rather than merely "no photo":
      // leaving the AI tier reachable invents a different body and invites the
      // same refusal.
      logger.warn('Refusals exhausted the photo pool — rendering text-only', {
        event: 'content.refusal_retry_without_imagery',
        organizationId,
        serviceId,
        graphicId,
        slideIndex: parsed.data.slideIndex ?? null,
        rotationsTried: refusalAttempt,
      });
      return generateBrandedGraphicImpl(
        db,
        {
          ...input,
          imageryPolicy: 'text-led',
          suppressSubjectPhoto: true,
          sourceAssetIds: undefined,
          preferStockImage: false,
          allowStockImages: false,
        },
        MAX_REFUSAL_ROTATIONS + 1
      );
    }
    return err(gen.error) as Result<GenerateBrandedGraphicOutput>;
  }

  // Normalise to PNG and scale to the target WIDTH only — preserve the model's
  // aspect ratio (it composed at 4:5) so NOTHING is cropped. Report the actual
  // pixel dimensions so the output strip is accurate.
  let png = gen.data.png;
  let width = CANVAS.w;
  let height = CANVAS.h;
  try {
    png = await sharp(gen.data.png)
      .resize({ width: CANVAS.w, withoutEnlargement: false })
      .png()
      .toBuffer();
    const meta = await sharp(png).metadata();
    width = meta.width ?? CANVAS.w;
    height = meta.height ?? CANVAS.h;
  } catch {
    png = gen.data.png; // worst case ship the raw bytes at default dims
  }

  // Two conditions worth a WARN rather than just a field, because both are
  // actionable by a human and both produce the complaints we keep getting.
  if (logoOutcome !== 'used') {
    // Without a logo the model still has to fill the space the layout leaves
    // for one, so it re-typesets the business name — differently every render.
    // That is the "logo style keeps changing" complaint, and for the 35% of
    // orgs with no logo on file the fix is to ask them for one.
    logger.warn('Graphic generated without the brand logo', {
      organizationId,
      serviceId,
      graphicId,
      logoOutcome,
    });
  }
  if (!usedServiceMedia) {
    // No real photo of the treatment reached the model, so the subject
    // imagery is invented. Customers ask us to stop doing exactly this
    // ("only use real pictures of me").
    logger.warn('Graphic generated with no real service media', {
      organizationId,
      serviceId,
      graphicId,
      candidateCount: slotDecision?.candidateAssetIds?.length ?? 0,
      slotSource: slotDecision?.source ?? 'none',
    });
  }

  // Provenance: one row per selection decision. Best-effort — a diagnostic
  // write must never fail a render that already succeeded.
  await recordProvenanceSafe(db, {
    organizationId,
    subjectType: 'graphic',
    subjectId: graphicId ?? `ungrouped-${Date.now()}`,
    serviceId,
    chosenAssetId: slotDecision?.consumedAssetId,
    mediaSource: toProvenanceMediaSource(
      slotDecision?.source,
      sourceAssetIds,
      imagery.kind
    ),
    logoOutcome,
    candidatesConsidered: slotDecision?.candidateAssetIds,
    // WHY THERE IS NO PHOTOGRAPH ON THIS GRAPHIC.
    //
    // The column existed and nothing ever wrote it, so the one question a
    // "wrong/missing image" report actually asks — what did you have, and why
    // did you not use it? — had no answer anywhere. An asset named explicitly by
    // the caller and then not used is the case worth recording: it is silent by
    // construction, because naming an asset skips rotation and a failure to
    // resolve it falls straight through to invented imagery.
    rejectedCandidates:
      sourceAssetIds?.length && !slotDecision?.consumedAssetId
        ? sourceAssetIds.map((assetId) => ({
            assetId,
            reason: 'named-but-unresolved',
            detail:
              'Named by the caller but produced no usable still — deleted, not `raw`, or a video with no generated thumbnail. The slot fell through to the imagery policy.',
          }))
        : undefined,
    templateSlug,
    model: gen.data.model,
    detail: {
      // What this render WAS, so a deck can be read back slide by slide and a
      // silent full recompose is visible as seven `compose` rows where two
      // `refine-slide` rows were expected.
      operation: parsed.data.provenanceOperation ?? 'compose',
      slideIndex: parsed.data.slideIndex ?? null,
      refinementInstruction: parsed.data.refinementInstruction ?? null,
      usedServiceMedia,
      referenceCount,
      rotationPoolSize: slotDecision?.rotationPoolSize ?? 0,
      excludedForQuality: slotDecision?.excludedForQuality ?? 0,
      hasInspirationImage: Boolean(parsed.data.inspirationImageBase64),
      // WHICH POSTS TAUGHT THIS GRAPHIC ITS DESIGN.
      //
      // `referenceCount` said how many, never which — and with the default of
      // one reference, that single post IS the design language of the whole
      // deck. Working out which post a set of graphics had imitated meant
      // re-deriving the selection by hand against a corpus that had since moved
      // on. The keys are stable and the bytes are ours, so this stays resolvable
      // for as long as the corpus does.
      referenceKeys: parsed.data.styleReferenceUrls ?? [],
      // WHICH LAYOUT SIGNAL WAS ACTUALLY SENT.
      //
      // Screenshot, prose, or nothing. This was only ever derivable by reading
      // two call sites against an env var, and the answer for production turned
      // out to be a combination nobody knew was reachable. Recording it makes
      // "what was this rendered with" a query rather than an archaeology
      // exercise — and the flag has changed meaning once already.
      layoutMode: parsed.data.inspirationImageBase64
        ? 'screenshot'
        : layoutPrompt
          ? 'prose'
          : 'none',
      // The references were admitted without a single one carrying the org's
      // mark. Fires for a brand that does not stamp its posts, and for one that
      // has rebranded — where every reference teaches the previous brand.
      logoMatchFallback: parsed.data.referenceLogoMatchFallback ?? null,

      /**
       * WHAT THE MODEL WAS ACTUALLY HANDED.
       *
       * Everything above records decisions ABOUT the render; none of it
       * records the render's inputs, and the inputs are where four separate
       * investigations went wrong in one week. Each was a question of the form
       * "was X in this request?", each was answerable only by re-deriving the
       * call by hand against flags and branches, and each was answered wrongly:
       *
       *   - an ablation switch had silently stopped firing, so nine
       *     "components removed" rows had rendered the full prompt;
       *   - a "font reference" image was cleared as harmless by a probe that
       *     happened to carry a layout brief, then found reproducing itself
       *     onto slides when nothing competed with it;
       *   - a slide that plainly was not an edit turned out to have been
       *     re-rendered by the quality gate, which is a different call
       *     entirely;
       *   - a prior image that fails to fetch turns a surgical edit into a
       *     full re-roll, warns, and continues.
       *
       * The roles are the manifest the prompt itself uses, so this is what the
       * model saw, not a reconstruction of what it should have seen.
       */
      inputImageRoles: inputs.map((i) => i.role.slice(0, 60)),
      intent,
      /**
       * The distinction that makes an amendment an amendment. Requested and
       * loaded are separate on purpose: the gap between them is the silent
       * re-roll, and it has no other signal.
       */
      priorImageRequested: Boolean(
        parsed.data.priorImageBase64 ?? parsed.data.priorImageUrl
      ),
      priorImageLoaded: hasPriorImage,
      /** The colour this deck was told to sit on, if any resolved. */
      deckGroundColour: parsed.data.deckGroundColour ?? null,
      hasDeckAnchor: Boolean(parsed.data.deckAnchorBase64),
    },
  });

  return ok({
    png,
    width,
    height,
    model: gen.data.model,
    usedServiceMedia,
    imagerySource: imagery.kind,
    referenceCount,
    /**
     * The photograph this render actually used.
     *
     * Reported so a CORRECTIVE re-render can pin it. The quality gate's
     * re-render re-resolves the slot from scratch, and with no asset named it
     * reached into the service pool and took the photograph the NEXT slide was
     * already showing — putting a duplicate into a deck that had been built
     * without one. A correction is supposed to fix a defect, not reshuffle the
     * imagery.
     */
    consumedAssetId: slotDecision?.consumedAssetId,
  });
};

/**
 * Map a slot-resolution tier onto the provenance vocabulary.
 *
 * An owner-selected asset is recorded as `owner-selected` regardless of which
 * tier served it — the distinction that matters later is "a human chose this",
 * because those rows must not be read as evidence that automatic selection
 * worked.
 *
 * REPORT THE OUTCOME, NOT THE REQUEST. `sourceAssetIds` says an asset was ASKED
 * for; it does not say one was USED. Returning `owner-selected` on the strength
 * of the ask alone meant four slides that resolved nothing and were drawn
 * entirely by the model were filed as the owner's own photography — the exact
 * rows a "how often do we invent imagery?" report must count, recorded as its
 * opposite. So the resolved imagery is consulted first and has the last word:
 * when nothing came back, no request can make the answer `owner-selected`.
 */
function toProvenanceMediaSource(
  source: ResolveSlotImageSource | undefined,
  sourceAssetIds: string[] | undefined,
  imageryKind: ImagerySourceKind
): ProvenanceMediaSource {
  // Nothing was supplied to the model, or the model drew it. Neither is an
  // asset selection, however the caller asked.
  if (imageryKind === 'none') return 'none';
  if (imageryKind === 'model-invented' || imageryKind === 'ai-fill') {
    return 'ai-generated';
  }
  if (sourceAssetIds?.length) return 'owner-selected';
  switch (source) {
    case 'service-video-thumbnail':
      return 'service-video-thumbnail';
    case 'service-image-asset':
      return 'service-image-asset';
    case 'stock-image':
      return 'stock';
    case 'ai-generated':
      return 'ai-generated';
    default:
      return 'none';
  }
}

export const generateBrandedGraphic = (
  db: DbConnection,
  input: GenerateBrandedGraphicInput
) =>
  trackedResult(
    'imageGeneration.generateBrandedGraphic',
    () => generateBrandedGraphicImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
    }
  );

export type GenerateBrandedGraphicResult = Awaited<
  ReturnType<typeof generateBrandedGraphic>
>;
