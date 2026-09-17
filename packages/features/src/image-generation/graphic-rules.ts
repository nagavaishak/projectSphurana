/**
 * The rules every generated graphic must obey, stated ONCE.
 *
 * ## Why
 *
 * The same prohibitions were written out in seven files — the carousel
 * registry, the singles registry, the branded-graphic prompt builder, the
 * inspection gate, the corpus builder, the inspiration selector and the slot
 * resolver. "No pagination dots" appeared in four of them in four different
 * wordings; the before/after ban appeared in three and still leaked twice.
 *
 * That is not a tidiness problem. When a rule lives in N places, tightening it
 * means finding all N, and a rule that is tightened in three places and left
 * alone in the fourth reads exactly like a rule that does not work — which is
 * how an afternoon went into rewording a ban that was already stated correctly
 * somewhere else and contradicted here.
 *
 * So: one definition per rule, referenced by name. A template composes the
 * rules it needs; it does not restate them. If a rule needs to change, it
 * changes here and every prompt that references it changes with it.
 *
 * These are DIRECTIVES — instructions about the render. None of them is ever
 * copy, and `serialiseGraphicPrompt` keeps them out of the channel that gets
 * drawn. See `graphic-prompt.ts`.
 */

/**
 * No results comparisons, in any form.
 *
 * A before/after pair asserts a treatment outcome the business may not have
 * produced, and the imagery to fill one honestly almost never exists — so the
 * model invents two faces, which is a claim about a real person's results.
 * Banned outright rather than conditioned, because every conditional version of
 * this rule has leaked.
 */
export const RULE_NO_BEFORE_AFTER =
  'NEVER produce a BEFORE/AFTER pair, a split-image comparison of the same subject, or any results comparison — not even if the copy mentions results; describe the outcome in words instead.';

/**
 * No social-media interface furniture.
 *
 * The layout references are real Instagram screenshots, so the chrome is in
 * every example the model sees. Templates used to ASK for "dot pagination" and
 * "swipe →" and the gate then failed the renders for having them — a rule
 * fighting itself across two files.
 */
export const RULE_NO_SOCIAL_CHROME =
  'Do NOT add social-media interface chrome — no pagination dots, swipe arrows, navigation buttons, like/comment/share/bookmark icons, profile or header bars, or another account\'s watermark. Render only the finished creative artwork itself. This applies to WORDS as well as icons: never write "swipe", "swipe up", "tap", "link in bio", "vote", "comment below", "share this" or "follow us" anywhere in the copy. A graphic is read on its own; an instruction to swipe is chrome whether it is drawn as an arrow or set as a sentence.';

/**
 * Never reproduce a reference's photography.
 *
 * References are the brand's own past posts, shown to teach the visual system.
 * Copying their photographs republishes old content as new — and on a
 * photo-led brand it republishes a real client's face.
 */
export const RULE_NO_REFERENCE_PHOTOS =
  "Any photograph must be the brand's own supplied image or a fresh one of the described subject — never reproduce a reference's faces or exact photograph.";

/**
 * The brand's own posts decide appearance; the template decides structure.
 *
 * Templates describe which elements are present and where. Everything about how
 * they LOOK comes from the references, because a template that described
 * appearance overrode the brand — this is the rule that stopped a maroon
 * clinic's decks coming out in someone else's gold.
 */
export const RULE_STRUCTURE_NOT_APPEARANCE =
  'This describes the STRUCTURE — which elements are present, their order, their rough placement and whether there is a photograph. It says NOTHING about how they look. Take the palette, typefaces, background treatment, panel and button shapes, and every other styling decision from the BRAND example posts; where this text and those posts could disagree about appearance, the posts win.';

/**
 * Never read words out of a supplied photograph.
 *
 * `was EUR 150 now EUR 130` kept appearing in decks that were given no offer.
 * It is printed on a supplier's marketing graphic sitting in the org's asset
 * library, and the model was reading it out of the image and repeating it as
 * copy. Nothing invented it.
 */
export const RULE_NO_TEXT_FROM_PHOTO =
  'Treat any supplied photograph as IMAGERY ONLY. Words, prices, logos, watermarks or BEFORE/AFTER labels printed inside it are not part of this design: never copy them into the graphic, and never treat them as the copy to render.';

/**
 * A photograph is subject matter, not a palette.
 *
 * The palette directive names the BRAND POSTS as the colour source, and nothing
 * ever excluded the injected photograph — which is the largest, most saturated
 * thing in the request. A clinic whose brand is green and gold kept producing
 * graphics with purple panels and magenta type, because its one linked asset is
 * a purple laser handpiece under magenta light. The model was not disobeying;
 * it was reading colour off the biggest image it had.
 */
export const RULE_NO_PALETTE_FROM_PHOTO =
  "The supplied photograph is SUBJECT MATTER, not a colour source. Do NOT sample its colours into the design: its hues must not become the background, panels, blocks, rules, type colour or accents. Those come only from the brand's own posts and its logo. A photograph containing a strong colour the brand does not use — equipment, lighting, gloves, packaging — must stay confined to the photograph itself.";

/**
 * A photograph is part of the composition, not a sticker on it.
 *
 * FALLBACK ONLY — use this when there is NO design model to copy.
 *
 * With a brand reference in hand the photo treatment must come from THAT, not
 * from here: a brand whose house style is a framed card with even margins is
 * not doing it wrong, and a generic rule saying "never leave a uniform margin"
 * would argue with the very image we told the model to imitate. That is the
 * mistake `7b2c09541` removed from the templates — appearance stated in prose,
 * competing with appearance shown in a picture — and it is easy to reintroduce
 * one clause at a time.
 *
 * So this exists for the referenceless case, where the model has nothing to
 * copy and the photo otherwise arrives as a rectangle parked mid-canvas.
 */
export const RULE_COMPOSE_THE_PHOTO =
  'COMPOSE the photograph into the design rather than placing it on top of it: bleed it to at least one edge of the canvas, or crop it into a shape the layout already owns, or let type and panels overlap it. Do NOT drop it in as a floating rectangle centred in the frame with the rest of the design arranged around it, and do NOT leave a uniform margin on all four sides of it.';

/**
 * One slide, one frame.
 *
 * The layout references are carousel SCREENSHOTS, so the model periodically
 * "reproduces the carousel" — tiling several slides into one image.
 */
export const RULE_ONE_SLIDE =
  'Produce EXACTLY ONE slide as a single full-frame composition that fills the entire canvas edge to edge. Do NOT create a grid, collage, montage, contact sheet, multi-panel layout, thumbnail strip, or any preview of other slides — never show more than one slide inside the image.';

/**
 * The preamble shared by every curated template, carousel and single alike.
 *
 * These were two separately maintained near-duplicate strings. They had already
 * drifted — one said "any results comparison", the other said `"results"
 * comparison` — which is precisely the drift this module exists to prevent.
 */
export const TEMPLATE_STRUCTURE_PREAMBLE = [
  RULE_STRUCTURE_NOT_APPEARANCE,
  'Follow the element list and the copy exactly.',
  RULE_NO_BEFORE_AFTER,
  RULE_NO_SOCIAL_CHROME,
  RULE_NO_REFERENCE_PHOTOS,
].join(' ');
