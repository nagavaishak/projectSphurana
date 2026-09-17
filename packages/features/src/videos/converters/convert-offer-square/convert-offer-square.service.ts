// convertOfferSquare — pure function from a v1 offer-square-1 draftConfig to
// the v2 (TemplateDoc, brandFieldsForTheme, frozenOfferContent) triple.
//
// What it maps:
//   v1 offerCard.primaryColor        →  brandFieldsForTheme.colors.primary
//   v1 offerCard.secondaryColor      →  brandFieldsForTheme.colors.secondary
//   v1 offerCard.logoUrl             →  brandFieldsForTheme.logo.light
//   v1 offerCard.businessName        →  brandFieldsForTheme.identity.businessName
//   v1 offerCard.ctaText             →  brandFieldsForTheme.identity.ctaText
//   v1 offerCard.currencyCode        →  brandFieldsForTheme.identity.currency
//                                       (ISO 4217, 3-char) — falls through if
//                                       the v1 value doesn't match the 3-char
//                                       Theme contract.
//
//   v1 offerCard.headline            →  frozenOfferContent.headline
//   v1 offerCard.bulletPoints        →  frozenOfferContent.items
//   v1 offerCard.offerPriceCents     →  frozenOfferContent.price  (decimal str)
//   v1 offerCard.currencyCode        →  frozenOfferContent.currency  (also)
//   v1 offerCard.ctaText             →  frozenOfferContent.cta
//
// frozenOfferContent is the wave-7 backfill side channel for per-video offer
// values. The v2 synthesizer's `script-text` resolver doesn't yet have a
// `price` role (and `brand` has no `currency` field — see
// packages/video-templates/src/slot.ts), so we surface the v1 values here
// instead of forcing the synth path. Wave 7 persists these as a per-video
// override on the video row; the compiler reads them when emitting the
// info-card's resolved headline/items/price/cta/currency.
//
// What it doesn't carry:
//   v1 scriptText, narrationType, talkingHeadAssetId, bRollClips — offer-
//   square-1 has no talking-head leg and no per-clip ordering on the v1 path
//   (b-roll is auto-cut to music beats). Phase A resolves clips from the
//   org's procedure-tagged asset library at synth time.
//
//   v1 outro — offer-square-1 has no outro (the offer card IS the outro).
//
//   v1 musicTrackId — per-video, not a brand-wide preference. Wave 7 owns
//   the per-video music override path; this converter doesn't make that
//   decision today.

import type { VideoDraftConfig } from '@borradh-workspace/database';
import type { TemplateDoc } from '@borradh-workspace/video-templates';
// Import via the subpath export — the package root re-export is gated on the
// wave-6 integrator commit (see brief: "DO NOT edit packages/video-templates/
// src/index.ts"). Using @borradh-workspace/video-templates/offer-square-1
// keeps the dependency on the canonical TemplateDoc definition (single source
// of truth) without depending on integrator ordering.
import { offerSquare1 } from '@borradh-workspace/video-templates/offer-square-1';

import type { BrandFieldsForTheme } from '../converter-types.js';

/**
 * Per-video offer content frozen from a v1 draftConfig. Lives outside the
 * TemplateDoc because Slot doesn't yet have a `price` role on `script-text`
 * or a `currency` field on `brand`. The compiler reads this side channel
 * when present and uses it to override the TemplateDoc's `fixed` placeholders
 * on the info-card price + currency, and to set the per-video headline/items/
 * cta if the script-text resolver didn't produce values for them.
 *
 * Each field is independently optional so partial v1 offer cards (e.g. no
 * bullet points) don't synthesize as having empty arrays.
 */
export interface FrozenOfferContent {
  headline?: string;
  items?: string[];
  /**
   * Decimal-formatted price (e.g. '155.00'). Cents are divided by 100 with
   * two-decimal precision. The compiler prepends the currency symbol from
   * `currency`. We deliberately don't pre-format because per-locale
   * formatting belongs in the renderer, not the converter.
   */
  price?: string;
  /** ISO 4217 currency code (3 chars, e.g. 'EUR'). */
  currency?: string;
  cta?: string;
}

export interface OfferSquareConversionResult {
  templateDoc: TemplateDoc;
  templateId: 'offer-square-1';
  brandFieldsForTheme: BrandFieldsForTheme;
  /** Per-video offer values that don't fit the current Slot enum. */
  frozenOfferContent?: FrozenOfferContent;
}

function hexish(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^#[0-9A-Fa-f]{3,8}$/.test(value) ? value : undefined;
}

function isThreeCharCurrency(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value.toUpperCase());
}

function formatCents(cents: number | undefined): string | undefined {
  if (typeof cents !== 'number' || !Number.isFinite(cents) || cents < 0) {
    return undefined;
  }
  return (cents / 100).toFixed(2);
}

export function convertOfferSquare(
  draftConfig: VideoDraftConfig
): OfferSquareConversionResult {
  const offer = draftConfig.offerCard;

  // ── Brand fields side channel ───────────────────────────────────────
  // Wave 7's backfill merges this onto the org's brand_kit row. Each branch
  // is filled only when v1 had a real value so missing fields fall through
  // to the existing brand_kit / engineDefaultTheme.
  const brandFieldsForTheme: BrandFieldsForTheme = {};

  const primary = hexish(offer?.primaryColor);
  const secondary = hexish(offer?.secondaryColor);
  if (primary || secondary) {
    brandFieldsForTheme.colors = {};
    if (primary) brandFieldsForTheme.colors.primary = primary;
    if (secondary) brandFieldsForTheme.colors.secondary = secondary;
  }

  if (offer?.logoUrl) {
    brandFieldsForTheme.logo = { light: offer.logoUrl };
  }

  const identity: BrandFieldsForTheme['identity'] = {};
  if (offer?.businessName) identity.businessName = offer.businessName;
  if (offer?.ctaText) identity.ctaText = offer.ctaText;
  // v1 stored a free-form currencyCode; Theme.identity.currency contracts as
  // a 3-char ISO 4217 string. Only promote when the v1 value matches.
  if (offer?.currencyCode && isThreeCharCurrency(offer.currencyCode)) {
    identity.currency = offer.currencyCode.toUpperCase();
  }
  if (Object.keys(identity).length > 0) {
    brandFieldsForTheme.identity = identity;
  }

  // ── Frozen offer content (per-video, wave-7 backfill replay) ────────
  // The TemplateDoc's info-card has `fixed` placeholders on price.value and
  // price.currency because slot.ts has no 'price' script-text role and no
  // 'currency' brand field. The headline / items / cta DO have script-text
  // slots in the TemplateDoc, but Phase A's per-role script resolver
  // (wave 4-b) generates fresh copy; if a v1 video shipped with hand-edited
  // headline text we want to preserve that on replay. The compiler treats
  // frozenOfferContent as a per-video override applied on top of the
  // resolved RenderDoc.
  const frozen: FrozenOfferContent = {};
  if (offer?.headline) frozen.headline = offer.headline;
  if (offer?.bulletPoints && offer.bulletPoints.length > 0) {
    frozen.items = offer.bulletPoints;
  }
  const priceStr = formatCents(offer?.offerPriceCents);
  if (priceStr) frozen.price = priceStr;
  if (offer?.currencyCode) frozen.currency = offer.currencyCode;
  if (offer?.ctaText) frozen.cta = offer.ctaText;

  const frozenOfferContent =
    Object.keys(frozen).length > 0 ? frozen : undefined;

  return {
    templateDoc: offerSquare1,
    templateId: 'offer-square-1',
    brandFieldsForTheme,
    frozenOfferContent,
  };
}

export type ConvertOfferSquareResult = ReturnType<typeof convertOfferSquare>;
