/**
 * AD LAYOUTS ONLY.
 *
 * Organic content is described by briefs (`briefs.ts`) — a subject, with
 * appearance coming from the brand's own posts. This registry survives for ads,
 * where the layout genuinely is the choice being made: an offer pins its price
 * badge as the visual hero, which is a real requirement rather than a
 * description of a look.
 *
 * The organic entries still here are referenced by `Brief.replaces`, so a slug
 * pinned before briefs had identities keeps resolving. Do not add organic
 * templates. See docs/plans/graphic-generation-state-of-play.md §0.
 */
import { TEMPLATE_STRUCTURE_PREAMBLE } from '../graphic-rules.js';
import type { SingleTemplate } from './types.js';

/**
 * Curated SINGLE-graphic templates — structure only, same as the carousels.
 *
 * See `registry.ts` for why these stopped describing appearance. In short: the
 * old REBRAND wording made the template authoritative over the look, and the
 * brand's own posts lost to it.
 *
 * SCOPE. Only the ORGANIC templates below use `STRUCTURE`. The paid-ad
 * templates further down keep `AD_REBRAND` deliberately: an offer ad is not
 * trying to look like the brand's feed, it is trying to make one price the
 * single most prominent thing on the canvas, and that IS a layout requirement
 * rather than a style preference.
 *
 * Inspiration images live in S3 under `carousel-inspiration/_single/<slug>.jpg`.
 */

const STRUCTURE = TEMPLATE_STRUCTURE_PREAMBLE;

export const SINGLE_TEMPLATES: SingleTemplate[] = [
  {
    slug: 'stat-serif-centered',
    label: 'Centered serif stat / myth',
    description:
      'Ultra-clean type-only post on a plain near-white background: a large centered classic serif headline with one line set in italic accent colour, a small sans subline, a short centered divider rule, and the brand wordmark centered at the bottom. Best for a surprising stat, myth, or hook with no photo.',
    aspectRatio: '4:5',
    tags: ['stat', 'myth', 'hook', 'minimal', 'type-only', 'any'],
    usageType: 'organic',
    layoutPrompt: `${STRUCTURE} NO photograph. A large headline filling the middle, with its final line emphasised. A small subline below. A short divider rule beneath that. The brand logo at the very bottom.`,
    copySpec:
      'A surprising stat or myth as the headline, ~8-12 words across 2-3 centered lines, the punchline on the last line, emphasised. Then a one-line subline ~6-9 words adding the "so what". No CTA.',
  },
  {
    slug: 'concern-list-photo',
    label: 'Concern list over treatment photo',
    description:
      'A full-bleed real photo of the service being performed, with a semi-transparent dark box in the lower-left holding a serif lead-in headline, a vertical list of the concerns the treatment improves, and the service name. Best when you have a real treatment/clinic photo and want to list what one treatment fixes.',
    aspectRatio: '4:5',
    tags: ['benefits', 'list', 'treatment', 'photo', 'aesthetics'],
    usageType: 'organic',
    layoutPrompt: `${STRUCTURE} A full-bleed REAL photograph of the service being performed as the entire background. A TRANSLUCENT panel (roughly 55-65% opacity — NOT a heavy opaque block; the photograph still shows through it) occupying roughly the lower-left half. Inside the panel, top to bottom and left-aligned: a lead-in headline ending in a colon, then a vertical list of short concern or benefit words, one per line, then a smaller service-name label near the bottom. Ensure strong contrast between the text and the panel so it stays legible.`,
    copySpec:
      'A lead-in ending in a colon (~3-4 words, e.g. "One treatment that improves:"), then 3-5 single- or two-word concern/benefit items one per line, then the service name as the label line.',
  },
  {
    slug: 'its-not-cheap-longform',
    label: 'Long-form objection / value editorial',
    description:
      'A long-form, left-aligned editorial on a plain light background with a very faint, washed-out product photo bleeding in. A big serif headline, a small italic lead-in, a short serif paragraph, an italic transition, then several bold-serif objection lines each followed by a plain-serif rebuttal, a list of short "It wouldn\'t…" lines, a bold closing line, and the @handle. Best for a premium "why we\'re worth it / why cheap is risky" value post.',
    aspectRatio: '4:5',
    tags: ['value', 'objection', 'premium', 'longform', 'educational'],
    usageType: 'organic',
    layoutPrompt: `${STRUCTURE} A VERY faint, washed-out product or treatment photograph bleeding in behind the text, barely visible. All text left-aligned. Top: a large headline ending in a full stop. Then, with generous spacing: a small lead-in line; a short paragraph; a one-word transition ending in "…"; then several blocks, each a heavy objection line followed by a lighter rebuttal sentence; then a short list of "It wouldn't…" lines; then a heavy closing line; then a small @handle at the bottom-left.`,
    copySpec:
      'Headline ~2-3 words ending in a full stop. Lead-in ~2 words. A 1-sentence paragraph (~12-18 words). A transition ~1 word + "…". Then 3-4 objection blocks: each a bold "We could …" line (~4-7 words) + a rebuttal sentence (~12-20 words). Then 4-5 short "It wouldn\'t…" lines (~5-9 words each). Then a bold closing line "It wouldn\'t be <Brand>." Keep the same counts as this spec.',
  },
  {
    slug: 'testimonial-quote',
    label: 'Testimonial pull-quote card',
    description:
      'A real client quote, set big in serif with five stars. No photo needed.',
    aspectRatio: '4:5',
    tags: ['testimonial', 'social-proof', 'quote', 'type-only', 'trust', 'any'],
    usageType: 'organic',
    layoutPrompt: `${STRUCTURE} NO photograph and NO portrait of any person. A single OVERSIZED opening quotation mark sitting on its own line ABOVE the quote, left-aligned with the text block — it must NOT overlap or touch any words. Below it a large pull-quote across 3-4 lines, with one phrase emphasised (NEVER wrapped in asterisks or any markdown characters). Below the quote a small attribution line: an em-dash, the client's first name, a middot, and the treatment name. The quote block, attribution, five small stars in a row, and the brand logo are spaced evenly down the canvas so there is no large empty gap — the composition fills the middle ~75% of the frame.`,
    copySpec:
      'A first-person client quote ~15-25 words about how the treatment made them feel or what surprised them (specific, not generic praise), with one emphasised phrase — write the phrase as plain words, NEVER surround it with asterisks, quotes-within-quotes, or markdown symbols. Attribution: a first name + the treatment name (2-5 words total). No CTA.',
  },
  {
    slug: 'didyouknow-fact',
    label: '"Did you know?" fact tile',
    description:
      'One surprising fact with the key number set huge. Loud, simple, shareable.',
    aspectRatio: '4:5',
    tags: ['fact', 'stat', 'educational', 'shareable', 'bold', 'any'],
    usageType: 'organic',
    layoutPrompt: `${STRUCTURE} NO photograph. A small eyebrow label near the top containing a short uppercase line. Below it, a large fact statement across 3-4 lines filling the middle of the canvas, with the key number or key phrase set MUCH larger than the rest and in a colour that STRONGLY CONTRASTS with the background — never a darker or lighter shade of the same hue, which reads flat. Beneath the fact, a single smaller supporting line. A horizontal rule and the brand logo at the very bottom.`,
    copySpec:
      'Eyebrow: "DID YOU KNOW?" (or a ~3 word equivalent). The fact: one surprising, true, non-alarmist statement ~10-16 words with one number or 1-3 word key phrase as the hero element. Supporting line: ~8-12 words adding the "so what" for the reader. No CTA.',
  },
  {
    slug: 'poll-thisorthat',
    label: 'This-or-that comment poll',
    description: 'A or B? A split-screen poll that fills your comments.',
    aspectRatio: '4:5',
    tags: [
      'poll',
      'engagement',
      'this-or-that',
      'comments',
      'type-only',
      'any',
    ],
    usageType: 'organic',
    layoutPrompt: `${STRUCTURE} NO photograph. The canvas split into two equal VERTICAL panels, distinguishable from each other, meeting at a thin vertical seam with a small circular "VS" disc centered on it. Across the top, spanning both panels, a question headline on its own strip. In each panel: a badge containing a single letter (A on the left, B on the right) with the option text in 2-3 large lines directly beneath it — badge and text together vertically centred and LARGE enough to fill most of the panel's height, leaving no large empty areas. The option text must NOT repeat the letter (no "A:" prefix — the badge already carries it) and contains NO emoji. At the very bottom a full-width footer strip with an uppercase instruction and a small speech-bubble icon. The brand logo small at the top above the headline.`,
    copySpec:
      'A question headline ~5-9 words posing a light either/or choice related to the service or routine. Option A and Option B: ~2-5 words each, genuinely debatable (no obviously correct answer) — plain words only, never prefixed with "A:"/"B:" and no emoji. Footer: a ~4-6 word uppercase instruction (e.g. "VOTE A OR B BELOW").',
  },
];

/**
 * PAID-AD offer templates (usageType: 'ad').
 *
 * Unlike the organic templates, these are promotional offer ads: the layout is
 * built around a single, unmissable OFFER — a discount or a new price — with a
 * clear call-to-action. The goal is to get a unique offer out there and give a
 * reason to act NOW, WITHOUT looking like a generic Canva template. The badge
 * (discount / price) is the visual hero; the brand logo, treatment name and
 * outcome copy frame it. Copy is written from the org's `offer` + service by
 * `generateTemplatedSingle` (ad-aware copy writer) — the owner never fills
 * fields; the LLM composes the badge/treatment/benefits/CTA from the offer.
 *
 * Inspiration images live in S3 under `carousel-inspiration/_single/<slug>.jpg`
 * (same as organic). Missing image → graceful text-layout fallback.
 */

// Shared offer-ad guidance appended to every ad layoutPrompt.
const AD_REBRAND =
  "Reproduce this layout FAITHFULLY — same composition, same imagery type, same crops, same text placement, so it is clearly the same design. This is a PAID PROMOTIONAL AD: the OFFER (the Was/Now price drop — the old price struck through, the new price prominent; NEVER a percentage) is the visual hero and must be the single most prominent element. Change ONLY the colours (recolour to the brand palette), the fonts (use the brand font), the branding/logo (use the provided brand logo only), and the text (use the copy below). Do NOT copy the reference's colours, branding, logo, prices or wording. Use the brand's OWN real provided photo as the imagery — never reproduce the reference's faces or exact photo. Keep it premium and bespoke; it must NOT look like a generic template.";

const VOUCHER_NOTE =
  'The copy below is labelled by region (TREATMENT, BADGE, BENEFITS, CTA, VOUCHER). Place each labelled piece in its matching region of the layout. Do NOT render the region labels themselves — only their text. The BADGE is the offer and must be the largest, boldest element.';

const adSingleTemplates: SingleTemplate[] = [
  {
    slug: 'offer-benefits-split',
    label: 'Offer — benefits + price badge (split)',
    description:
      'The classic high-converting offer ad: a real treatment/result photo fills the left, the brand logo sits top-left, the treatment name top-right, a vertical list of outcome benefits down the right, a bold solid circular OFFER badge showing the Was/Now price drop (old price struck through, new price prominent) overlapping the centre, and a strong CTA button with a "claim your voucher" caption. Best all-rounder when you have a real photo and want benefits + offer + CTA in one frame.',
    aspectRatio: '4:5',
    tags: ['offer', 'discount', 'benefits', 'cta', 'ad', 'aesthetics'],
    usageType: 'ad',
    layoutPrompt: `${AD_REBRAND} ${VOUCHER_NOTE} Light near-white background. LEFT ~45%: the provided real treatment/result photo in a soft rounded card, bled to the left edge. The brand LOGO/wordmark sits small in the very top-left corner over the photo. RIGHT ~55%: a large bold sans TREATMENT-NAME headline across the top-right (two lines, heavy weight), then a vertical bulleted list of short outcome BENEFITS (round bullet dots) filling the middle-right. A bold SOLID CIRCULAR badge in a dark brand colour overlaps the seam between photo and panel in the lower third, containing the OFFER in heavy white text. Bottom-right: a solid rounded CTA button with an uppercase label, and a small letter-spaced VOUCHER caption beneath it.`,
    copySpec:
      'TREATMENT: the service name, 2-4 words, can be two lines. BADGE: the price drop, shown as the old price and the new price — shown as "Was <old price> Now <new price>" with the offer prices verbatim, keeping their currency symbol (old price struck through, new price largest). NEVER a percentage. BENEFITS: 5-7 outcome/benefit bullet lines, each 2-5 words, one per line. CTA: a 2-word uppercase action (e.g. "BOOK NOW"). VOUCHER: a short urgency/voucher caption, 2-3 words (e.g. "Claim your voucher").',
  },
  {
    slug: 'offer-owner-portrait',
    label: 'Offer — clinic owner / practitioner portrait',
    description:
      'Person-first trust ad: a full-bleed portrait of the clinic owner / practitioner (the provided real photo), with the brand logo in a corner and the offer + price/availability set as a bold overlay on one side. Use when personal brand and trust matter most. Person first, text on top, minimal clutter.',
    aspectRatio: '4:5',
    tags: ['offer', 'owner', 'trust', 'portrait', 'ad'],
    usageType: 'ad',
    layoutPrompt: `${AD_REBRAND} ${VOUCHER_NOTE} A FULL-BLEED portrait of the provided real photo (the practitioner/owner, or the brand's person), with a soft brand-colour gradient scrim down one side so overlaid text is legible. Brand LOGO small in a top corner. On the scrimmed side, stacked: a bold TREATMENT-NAME line, then a large bold OFFER badge/pill (the Was/Now price drop — old price struck through, new price prominent) as the hero, then a one-line availability/urgency note. A solid rounded CTA button near the bottom with a small VOUCHER caption. Person first; text sits on top, kept minimal and uncluttered.`,
    copySpec:
      'TREATMENT: the service name, 2-4 words. BADGE: the offer hero — the Was/Now price drop, shown as "Was <old price> Now <new price>" with the offer prices verbatim, keeping their currency symbol (old price struck through, new price largest); NEVER a percentage. BENEFITS: a SINGLE short availability/urgency line, 3-6 words (e.g. "Limited spots this month"). CTA: a 2-word uppercase action (e.g. "BOOK NOW"). VOUCHER: 2-3 words (e.g. "Claim your voucher").',
  },
  {
    slug: 'offer-procedure-photo',
    label: 'Offer — procedure in action',
    description:
      'Reassurance ad for treatments people are nervous about: the treatment being performed fills the frame (the provided real photo), with very minimal text — the offer and a short qualifier only. Procedure first, text minimal. Use when people fear the treatment and seeing it done calmly builds confidence.',
    aspectRatio: '4:5',
    tags: ['offer', 'procedure', 'reassurance', 'ad', 'aesthetics'],
    usageType: 'ad',
    layoutPrompt: `${AD_REBRAND} ${VOUCHER_NOTE} The provided real photo of the treatment being performed fills the ENTIRE frame, with a gentle brand-colour tint for cohesion and a subtle darkened band where text sits. Brand LOGO small in a top corner. Minimal text only: the TREATMENT name as a calm serif/sans label near the top, and a bold OFFER badge (the Was/Now price drop — old price struck through, new price prominent) as the hero lower down with a short reassuring qualifier beside it. A solid rounded CTA button at the bottom with a small VOUCHER caption. Keep text sparse — the procedure photo carries the ad.`,
    copySpec:
      'TREATMENT: the service name, 2-4 words. BADGE: the offer hero — the Was/Now price drop (offer prices verbatim with their currency symbol, old price struck through, new price largest); NEVER a percentage. BENEFITS: a SINGLE short reassuring qualifier, 3-6 words (e.g. "Quick, gentle, minimal downtime"). CTA: a 2-word uppercase action (e.g. "BOOK NOW"). VOUCHER: 2-3 words (e.g. "Claim your voucher").',
  },
  {
    slug: 'offer-clean-text',
    label: 'Offer — clean text-led',
    description:
      'Offer-as-hero ad on a clean brand-colour background with a small secondary procedure/result image. The offer is the biggest thing on the canvas; the image is supporting. Use when the deal itself is the strongest hook and you want maximum clarity. Text first, image secondary.',
    aspectRatio: '4:5',
    tags: ['offer', 'clean', 'text-led', 'ad', 'minimal'],
    usageType: 'ad',
    layoutPrompt: `${AD_REBRAND} ${VOUCHER_NOTE} A clean SOLID brand-colour background (no photo behind the text). Brand LOGO centered or top-left at the top. The OFFER badge is the giant centerpiece — the Was/Now price drop set very large in the middle (old price struck through, new price largest; never a percentage), with the TREATMENT name as a heading above it and a short benefit line below. A small rounded secondary thumbnail of the provided real procedure/result photo sits in a lower corner as support (not full-bleed). A solid rounded CTA button near the bottom with a small VOUCHER caption. Text-first; the image is secondary.`,
    copySpec:
      'TREATMENT: the service name, 2-4 words, as a heading. BADGE: the offer hero — the Was/Now price drop, shown as "Was <old price> Now <new price>" with the offer prices verbatim, keeping their currency symbol (old price struck through, new price the single largest element); NEVER a percentage. BENEFITS: ONE short benefit/value line, 4-7 words. CTA: a 2-word uppercase action (e.g. "BOOK NOW"). VOUCHER: 2-3 words (e.g. "Claim your voucher").',
  },
];

SINGLE_TEMPLATES.push(...adSingleTemplates);

export function getSingleTemplate(slug: string): SingleTemplate | undefined {
  return SINGLE_TEMPLATES.find((t) => t.slug === slug);
}
