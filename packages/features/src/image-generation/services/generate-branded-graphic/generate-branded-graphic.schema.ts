import { z } from 'zod';
import { renderCopySchema } from '../../graphic-prompt.js';
import { imageryPolicySchema } from '../../imagery-policy.js';

/**
 * Schema for single-shot AI branded-graphic generation ("nano banana").
 */
export const generateBrandedGraphicSchema = z.object({
  organizationId: z.string().min(1, 'organizationId required'),
  /** The service the graphic promotes — drives real-media lookup + copy. */
  serviceId: z.string().min(1, 'serviceId required'),
  /** What the graphic is about. */
  topic: z.string().min(1, 'topic required'),
  /**
   * Format hint (e.g. "before & after", "Q&A", "tip"). Falls back to the
   * retrieved reference's format, else a generic social post.
   */
  format: z.string().optional(),
  /** Override the image model. Defaults to gemini-3-pro-image. */
  model: z.string().optional(),
  /** Brand primary colour (hex) — used when no real media + no AI imagery. */
  brandPrimaryColor: z.string().optional(),
  /**
   * Whether the model may INVENT imagery when the org has no real uploaded
   * service media. Default false: with no media we fall back to a clean
   * branded background, never a fabricated depiction of the service.
   */
  allowAiImages: z.boolean().default(false),
  /**
   * Uploaded subject assets chosen by the owner. Their order is significant;
   * the first usable asset becomes this slide's subject image.
   */
  sourceAssetIds: z.array(z.string().min(1)).min(1).max(10).optional(),
  /**
   * When true, do NOT feed this slide the org's real uploaded service media as
   * the subject photo. Set by the carousel orchestrator for brand/text CTA
   * slides (`CarouselSlideTemplate.noSubjectPhoto`) so the model can't drop the
   * org's real photo — often the owner's headshot — into a "portrait" area on
   * the final slide. The layout for such slides is type-and-brand only.
   * Optional (defaults to undefined/falsy) so existing callers are unaffected.
   */
  suppressSubjectPhoto: z.boolean().optional(),
  /**
   * Render this graphic WITHOUT the brand mark. Set for every carousel slide
   * except the cover and brand/CTA cards (`CarouselSlideTemplate.showLogo`).
   *
   * When set, the logo images are not passed at all — the model cannot
   * reproduce a mark it was never shown — and the prompt forbids drawing one,
   * so it does not helpfully invent a wordmark to fill the gap.
   */
  suppressLogo: z.boolean().optional(),
  /** Varies the stock pick between slides of one deck. See resolveSlotImage. */
  slotRotationSalt: z.string().optional(),
  /**
   * Assets this render must NOT choose.
   *
   * `resolveSlotImage` has always accepted `usedAssetIds`; nothing could reach
   * it from here. The refusal retry needs it: a content block is specific to
   * the PHOTOGRAPH, so the next candidate usually passes, and without a way to
   * exclude the refused one the retry can only give up on imagery entirely.
   */
  excludeAssetIds: z.array(z.string()).optional(),
  /** Take a stock still rather than the service's own pool. See resolveSlotImage. */
  preferStockImage: z.boolean().optional(),
  /**
   * The finished sibling this slide is being built from, as BYTES.
   *
   * `priorImageUrl` exists for amendments, which fetch the previous render back
   * from S3. A deck built slide by slide never puts its siblings there — they
   * are in memory — so a URL would mean uploading a slide purely to hand it
   * back to the next call.
   */
  priorImageBase64: z.string().optional(),
  priorImageMediaType: z.string().optional(),

  /**
   * The colour this DECK sits on, resolved once for the whole set.
   *
   * Separate from composition on purpose. A slide may bleed a photograph to
   * every edge; this says what colour its flat areas are when it has any, so a
   * full-bleed slide and a panelled slide still belong to the same deck.
   */
  deckGroundColour: z.string().optional(),

  /**
   * The deck's COVER, already rendered, as a base64 image.
   *
   * Slides are generated in parallel, so none of them can see what the others
   * became. Every mechanism tried for deck coherence so far — a shared
   * reference set, the typography lock, "every slide of this set must share the
   * same background treatment" — DESCRIBES consistency; none lets a slide SEE
   * what it has to match. One deck came back with five different background
   * treatments across seven slides.
   *
   * Distinct from `priorImageUrl`, which means "you are amending this" and
   * deliberately drops the brand references. An anchor needs both.
   */
  deckAnchorBase64: z.string().optional(),
  deckAnchorMediaType: z.string().optional(),
  /**
   * WHICH slide the anchor is, so the instruction can name it correctly.
   *
   * `cover` — slide 1, the deck's specification (the default).
   * `previous` — the slide immediately before this one, for chained
   *   rendering. The wording matters: told "match slide 1" while handed
   *   slide 4, the model has to reconcile a label with a picture.
   */

  /**
   * What this regeneration is changing — see `regeneration-intent.ts`.
   *
   * Which reference images the model receives is decided by this, from one
   * table, rather than by conditionals tuned for whichever symptom was last
   * reported. Omitted, it is inferred for backwards compatibility.
   */
  regenerationIntent: z
    .enum(['copy', 'image', 'branding', 'sibling', 'full'])
    .optional(),
  /**
   * Whether the curated stock-image tier (resolveSlotImage tier 2.5) may fill
   * the subject slot when the org has no uploaded service media. Defaults true
   * so existing callers are unaffected; the manual generate-graphic flow sets
   * it false when the user turns off "Use curated stock photos".
   */
  allowStockImages: z.boolean().default(true),
  /**
   * The imagery policy as ONE named state. When supplied it REPLACES
   * `allowAiImages` / `allowStockImages`, which remain only so existing
   * callers keep working. See `image-generation/imagery-policy.ts`.
   */
  imageryPolicy: imageryPolicySchema.optional(),
  /**
   * The exact strings to RENDER, kept in their own channel.
   *
   * Copy used to travel inside `slideDirective` as prose — "This is slide 4 of
   * 7 (role: myth). Render EXACTLY this copy: …" — so the words to draw and the
   * instruction about the render arrived as one string, and the model
   * periodically drew `Slide 4/7` onto the canvas. Anything here is renderable;
   * anything in `slideDirective` is not.
   */
  renderCopy: renderCopySchema.optional(),
  /**
   * The GROUND the brand's own posts sit on, from `selectInspirationSet`.
   *
   * The selector has always computed this and nothing ever told the renderer.
   * The prompt said only "take the palette from the BRAND example posts", and
   * a brand resolved as `light-ground` came back with two of three singles on
   * near-black — off a single pale reference. Naming the ground costs one
   * sentence and removes the most visible way a render can miss the brand.
   */
  referenceColourway: z.string().optional(),
  /**
   * True when the reference set was chosen WITHOUT any post carrying the org's
   * own mark — see `InspirationSet.logoMatchFallback`.
   *
   * Recorded on the graphic's provenance rather than acted on. A render in this
   * state is not wrong, but it is built from references nothing has confirmed
   * belong to this brand, and that is worth being able to select on when a batch
   * comes back looking like somebody else.
   */
  referenceLogoMatchFallback: z.boolean().optional(),
  /**
   * Pre-resolved STYLE reference image URLs — the org's own past posts.
   *
   * A SET, not one image. One reference teaches the model a single layout; a
   * small coherent set teaches it the brand's visual system, which is what
   * reproduced logos and typography reliably in testing. The carousel
   * orchestrator resolves the set once and hands the same one to every slide so
   * the deck reads as a single post.
   *
   * When omitted, the service resolves the org's stored inspiration set itself.
   */
  styleReferenceUrls: z.array(z.string()).max(4).optional(),
  /**
   * Extra per-slide directive appended to the prompt (e.g. the orchestrator's
   * planned heading/body + this slide's role in the carousel). Keeps slide
   * copy distinct + on-narrative while brand/font/colour stay shared.
   */
  slideDirective: z.string().optional(),
  /**
   * A curated inspiration image (base64) used as the layout reference — from
   * the carousel/single template library. When set it REPLACES corpus
   * retrieval + styleReferenceUrl: this image's structural layout is what the
   * model reproduces (fully rebranded).
   */
  inspirationImageBase64: z.string().optional(),
  inspirationMediaType: z.string().optional(),
  /**
   * The template's SET PROMPT — the structural/rebrand layout instruction for
   * the inspiration image. Used in place of the generic style line.
   */
  layoutPrompt: z.string().optional(),
  /**
   * Pre-resolved brand LOGO polarities (base64 PNGs). The carousel orchestrator
   * resolves both ONCE (via `ensureLogoVariants`) and passes them to every
   * slide; each slide then picks the polarity that contrasts with its own
   * background. When omitted, the service resolves them itself. Sharing avoids
   * re-fetching + re-minting the inverted copy per slide.
   */
  logoLightBase64: z.string().optional(),
  logoLightMediaType: z.string().optional(),
  logoDarkBase64: z.string().optional(),
  logoDarkMediaType: z.string().optional(),
  /**
   * Free-text user instruction (e.g. "warmer tone", "bigger logo"). Appended to
   * the image prompt as the highest-priority change request.
   */
  refinementInstruction: z.string().optional(),
  /**
   * URL of the PREVIOUS render for refinement-aware regeneration. When set it
   * is fetched + passed to the model as a reference labelled "the previous
   * version" so it reproduces that design and applies ONLY the requested
   * change, instead of re-rolling the layout from scratch.
   */
  priorImageUrl: z.string().url().optional(),
  /**
   * The prior image as BYTES, for callers that already hold them.
   *
   * `priorImageUrl` exists because an amendment fetches the previous render
   * back from S3. A deck built slide by slide never puts its siblings there —
   * they are buffers in the same process — and round-tripping them through
   * storage to satisfy a URL field would add an upload, a signature and a
   * fetch to every slide for nothing.
   */
  /**
   * The single canonical handle/username/URL rendered in any footer/handle bar
   * (e.g. "@glittergirlsbeauty" or "glittergirlsbeauty.ie"). When omitted the
   * service derives it from the org (IG handle → website domain). Passing it
   * pins the SAME value across every carousel slide so the footer never drifts
   * (ENG-542: slides otherwise showed @GlitterGirlsBeauty / @glittergirlsbeauty
   * / the website interchangeably).
   */
  brandHandle: z.string().optional(),
  /**
   * True when this graphic is ONE slide of a multi-slide carousel. Turns on the
   * deck-wide typography lock (identical fonts across every slide) and stronger
   * cross-slide consistency wording. The carousel orchestrator sets it; single
   * graphics leave it false.
   */
  isCarouselSlide: z.boolean().optional(),

  /**
   * The `graphic` row this render belongs to, and the template that produced
   * it. Purely for provenance — they key the decision record to the artefact
   * the customer actually sees, so "this graphic used the wrong photo" is a
   * lookup rather than an investigation. Optional so non-graphic callers
   * (prototypes, previews) are unaffected.
   */
  graphicId: z.string().min(1).optional(),
  templateSlug: z.string().min(1).optional(),
  /**
   * Which slide of a carousel this render is, and why it was rendered.
   *
   * Without these a deck's provenance is seven rows that cannot be told apart,
   * and — worse — cannot be distinguished from seven rows of a FRESH compose.
   * That is the difference between "the edit was applied to slide 2" and "the
   * whole deck was silently replaced", which is exactly the question that could
   * not be answered from the database when a stripped instruction caused the
   * latter.
   */
  slideIndex: z.number().int().min(0).optional(),
  /**
   * The graphic this render is AMENDING, when it is one.
   *
   * Used to pin the photograph: the prior render's chosen asset is looked up
   * from provenance and reused, so an edit cannot silently swap the picture by
   * re-entering least-recently-used selection.
   */
  priorGraphicId: z.string().min(1).optional(),
  provenanceOperation: z
    .enum(['compose', 'refine-slide', 'refine-deck'])
    .optional(),
});

/**
 * `z.input`, not `z.infer`: fields with a `.default()` (e.g. `allowAiImages`,
 * `allowStockImages`) are required on the parsed OUTPUT type but must stay
 * optional for callers.
 */
export type GenerateBrandedGraphicInput = z.input<
  typeof generateBrandedGraphicSchema
>;
