import { trackedResult } from '@borradh-workspace/observability';
import { listOffers } from '../../../offers/index.js';
import { getService } from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  extractPriceCents,
  taxonomiseService,
} from '../../verticals/aesthetic-clinic/service-taxonomy.js';
import {
  type SuggestIntroOfferInput,
  type SuggestIntroOfferOutput,
  type SuggestedIntroOffer,
  suggestIntroOfferSchema,
} from './suggest-intro-offer.schema.js';

/**
 * Band (inclusive) within which an EXISTING offer counts as a usable intro
 * offer. Wider than the 30–40% target band for a *new* offer — an existing
 * 25%-off new-client deal is "good enough" to reuse rather than forcing the
 * owner to make a fresh one.
 */
const EXISTING_FIT_MIN_PCT = 20;
const EXISTING_FIT_MAX_PCT = 55;

const formatEuros = (cents: number): string => {
  const major = cents / 100;
  return Number.isInteger(major) ? `€${major}` : `€${major.toFixed(2)}`;
};

/**
 * Curated regular-price → intro-price anchors (in major currency units, not
 * cents). These are hand-picked charm prices, NOT a flat percentage — the
 * implied discount deepens as the regular price climbs (a €100 service barely
 * drops, a €500 one roughly halves). Between anchors we interpolate; outside
 * the range we scale by the nearest anchor's ratio. Every result snaps to a
 * charm price ending in 9.
 */
const INTRO_PRICE_ANCHORS: ReadonlyArray<
  readonly [regular: number, intro: number]
> = [
  [100, 79],
  [150, 89],
  [200, 129],
  [300, 199],
  [500, 249],
] as const;

/** Round to the nearest "…9" charm price (e.g. 83 → 79, 164 → 159), min 9. */
const snapToCharmPrice = (value: number): number =>
  Math.max(9, Math.round(value / 10) * 10 - 1);

/**
 * Suggested new-client intro price (major units) for a regular price, from the
 * curated anchors. Interpolates between bracketing anchors and scales by the
 * nearest anchor's ratio outside the range, then snaps to a charm price.
 */
const suggestIntroPriceMajor = (regular: number): number => {
  const first = INTRO_PRICE_ANCHORS[0];
  const last = INTRO_PRICE_ANCHORS[INTRO_PRICE_ANCHORS.length - 1];

  if (regular <= first[0]) {
    return snapToCharmPrice(regular * (first[1] / first[0]));
  }
  if (regular >= last[0]) {
    return snapToCharmPrice(regular * (last[1] / last[0]));
  }
  for (let i = 0; i < INTRO_PRICE_ANCHORS.length - 1; i++) {
    const [r0, i0] = INTRO_PRICE_ANCHORS[i];
    const [r1, i1] = INTRO_PRICE_ANCHORS[i + 1];
    if (regular >= r0 && regular <= r1) {
      const t = (regular - r0) / (r1 - r0);
      return snapToCharmPrice(i0 + t * (i1 - i0));
    }
  }
  // Unreachable (the guards above cover the whole range) — defensive only.
  return snapToCharmPrice(regular * 0.65);
};

/**
 * Build a get-in-the-door, new-client-only intro offer for a service — or tell
 * Claire why she can't (POM/surgical), or that she needs the price first.
 *
 * This is the deterministic backbone shared by the "make an offer video" flow
 * and the "create campaign" flow, so both produce the SAME intro-offer logic
 * (30–40% below the regular one-session price) instead of two prompt-driven
 * guesses. It reuses the recommendation engine's price parser
 * (`extractPriceCents`) and taxonomy (`taxonomiseService`) so the numbers and
 * the POM/surgical guardrails match the rest of Claire.
 *
 * The intro-offer rationale (CAC framing — the customer pays for their own
 * acquisition, every rebook is profit) is returned in `suggested.why` so Claire
 * can explain WHAT the offer is and WHY before building the video.
 */
const suggestIntroOfferImpl = async (
  db: DbConnection,
  input: SuggestIntroOfferInput
): Promise<Result<SuggestIntroOfferOutput>> => {
  const parsed = suggestIntroOfferSchema.safeParse(input);
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
    oneSessionPrice,
    offerPrice,
    targetDiscountPercent,
  } = parsed.data;

  const serviceResult = await getService(db, { id: serviceId, organizationId });
  if (!serviceResult.success) {
    // `getService` is trackedResult-wrapped, so its error is the structural
    // `{ code, message, details }` shape — re-wrap into a FeatureError.
    return err(
      new FeatureError(
        serviceResult.error.code,
        serviceResult.error.message,
        serviceResult.error.details
      )
    );
  }
  const service = serviceResult.data;
  const serviceName = service.name;

  const taxonomy = taxonomiseService(service);

  // POM / surgical services never get a cold-traffic price offer. Mirror the
  // engine's strategy split (`pickOfferStrategy`): POM can't be advertised at
  // all; surgical/major sells the consultation, not a discounted price.
  if (taxonomy.isPOM) {
    return ok({
      serviceId,
      serviceName,
      advisable: false,
      advisoryReason: `${serviceName} is a prescription-only treatment — I can't put it on a cold offer or name it in an ad. I can advertise the broader category instead, or pick a different service to lead with.`,
      needsPrice: false,
      targetDiscountPercent,
      existingFit: null,
      suggested: null,
    });
  }
  if (taxonomy.isSurgical) {
    return ok({
      serviceId,
      serviceName,
      advisable: false,
      advisoryReason: `${serviceName} is a surgical/major procedure — I sell the consultation on these, never a price. I won't build a discounted intro offer for it; we lead with a free consultation instead.`,
      needsPrice: false,
      targetDiscountPercent,
      existingFit: null,
      suggested: null,
    });
  }

  // The regular one-session price is taken from the owner first, then parsed
  // from the service's freeform `priceText` as a fallback. The parse is
  // best-effort and can be noisy (body contouring lists per-area prices like
  // "Buttocks £85", "from £X", or packages), so a parsed price is tagged
  // `priceSource: 'parsed'` and Claire PRESENTS it for confirmation ("your
  // regular price is €X — happy to run the intro at €Y?") rather than
  // committing silently. The owner's confirmation at that gate is the safety
  // net against a wrong parse — which is faster than refusing to read a price
  // that's sitting right there on the service.
  const ownerPriceCents =
    oneSessionPrice !== undefined
      ? Math.round(oneSessionPrice * 100)
      : undefined;

  // Owner may set the intro price directly instead of taking the suggestion.
  const explicitOfferCents =
    offerPrice !== undefined ? Math.round(offerPrice * 100) : undefined;

  // The structured `price_cents` column is now the source of truth for a
  // service's list price (owner-set in the editor, or migrated from the old
  // freeform `priceText`). Prefer it whenever set — it's authoritative, so no
  // "is this parse right?" confirmation gate is needed. Only fall back to the
  // heuristic `extractPriceCents(priceText)` when priceCents is null AND the
  // owner supplied no numbers of their own.
  const structuredPriceCents = service.priceCents ?? undefined;
  const parsedPriceCents =
    ownerPriceCents === undefined &&
    explicitOfferCents === undefined &&
    structuredPriceCents === undefined
      ? extractPriceCents(service)
      : undefined;

  const oneSessionPriceCents =
    ownerPriceCents ?? structuredPriceCents ?? parsedPriceCents;
  // A stored structured price is as reliable as an owner-stated one, so it maps
  // to 'owner' (committed) rather than 'parsed' (present-for-confirmation).
  const priceSource: 'owner' | 'parsed' | undefined =
    ownerPriceCents !== undefined || structuredPriceCents !== undefined
      ? 'owner'
      : parsedPriceCents !== undefined
        ? 'parsed'
        : undefined;

  // Evaluate existing active offers linked to this service as intro candidates
  // regardless of whether we know the price (an existing deal is reusable).
  const existingFit = await findExistingIntroFit(
    db,
    organizationId,
    serviceId,
    targetDiscountPercent
  );

  // We need at least the regular price (to compute/anchor the intro) OR an
  // explicit offer price the owner stated. With neither, ask for both — the
  // priceText couldn't be parsed and nothing was supplied.
  if (oneSessionPriceCents === undefined && explicitOfferCents === undefined) {
    return ok({
      serviceId,
      serviceName,
      advisable: true,
      needsPrice: true,
      targetDiscountPercent,
      existingFit,
      suggested: null,
    });
  }

  let offerPriceCents: number;
  let discountPercent: number | undefined;
  if (explicitOfferCents !== undefined) {
    // Owner-stated intro price wins verbatim; derive the discount if we know
    // the regular price.
    offerPriceCents = explicitOfferCents;
    if (oneSessionPriceCents !== undefined && oneSessionPriceCents > 0) {
      discountPercent = Math.round(
        (1 - offerPriceCents / oneSessionPriceCents) * 100
      );
    }
  } else {
    // No explicit offer price — pick the curated intro price from the anchors
    // (a charm price ending in 9, deeper discount for pricier services).
    // oneSessionPriceCents is defined here (guarded above).
    const regularMajor = (oneSessionPriceCents as number) / 100;
    offerPriceCents = Math.round(suggestIntroPriceMajor(regularMajor) * 100);
    if ((oneSessionPriceCents as number) > 0) {
      discountPercent = Math.round(
        (1 - offerPriceCents / (oneSessionPriceCents as number)) * 100
      );
    }
  }

  const regularLine =
    oneSessionPriceCents !== undefined
      ? ` instead of your regular ${formatEuros(oneSessionPriceCents)}`
      : '';

  const suggested: SuggestedIntroOffer = {
    name: `${serviceName} — New Client Intro`,
    discountType: 'fixed_price',
    ...(oneSessionPriceCents !== undefined
      ? { originalPriceCents: oneSessionPriceCents }
      : {}),
    offerPriceCents,
    ...(discountPercent !== undefined ? { discountPercent } : {}),
    audienceText: 'New clients only',
    limitPerClient: true,
    why: `This is a first-visit-only price — ${formatEuros(offerPriceCents)}${regularLine}. Your normal price stays the same; this is just what it costs to get a new client through the door. The goal is a base of clients who come back — the first visit covers its own acquisition cost, and every rebooking after that is profit.`,
  };

  return ok({
    serviceId,
    serviceName,
    advisable: true,
    needsPrice: false,
    oneSessionPriceCents,
    ...(priceSource !== undefined ? { priceSource } : {}),
    targetDiscountPercent,
    existingFit,
    suggested,
  });
};

/**
 * Find the best existing ACTIVE offer linked to the service that already reads
 * as an intro offer: a 20–55% discount AND a new-client signal
 * (`limitPerClient`). Returns the closest-to-target match, or null.
 */
const findExistingIntroFit = async (
  db: DbConnection,
  organizationId: string,
  serviceId: string,
  targetDiscountPercent: number
): Promise<SuggestIntroOfferOutput['existingFit']> => {
  const offersResult = await listOffers(db, {
    organizationId,
    state: 'active',
    limit: 100,
    offset: 0,
  });
  if (!offersResult.success) return null;

  const candidates = offersResult.data.items
    .filter((o) => o.serviceIds.includes(serviceId))
    .map((o) => {
      const impliedDiscountPercent =
        o.discountPercent ??
        (o.originalPriceCents && o.offerPriceCents && o.originalPriceCents > 0
          ? Math.round((1 - o.offerPriceCents / o.originalPriceCents) * 100)
          : null);
      return { offer: o, impliedDiscountPercent };
    })
    .filter(
      (c) =>
        c.impliedDiscountPercent !== null &&
        c.impliedDiscountPercent >= EXISTING_FIT_MIN_PCT &&
        c.impliedDiscountPercent <= EXISTING_FIT_MAX_PCT &&
        // New-client signal — an intro offer is first-visit-only.
        c.offer.limitPerClient
    );

  if (candidates.length === 0) return null;

  // Closest discount to the target wins.
  candidates.sort(
    (a, b) =>
      Math.abs((a.impliedDiscountPercent ?? 0) - targetDiscountPercent) -
      Math.abs((b.impliedDiscountPercent ?? 0) - targetDiscountPercent)
  );
  const best = candidates[0];

  return {
    offerId: best.offer.id,
    name: best.offer.name,
    originalPriceCents: best.offer.originalPriceCents,
    offerPriceCents: best.offer.offerPriceCents,
    discountPercent: best.offer.discountPercent,
    impliedDiscountPercent: best.impliedDiscountPercent,
    reason:
      `"${best.offer.name}" is already a new-client-only deal at roughly ` +
      `${best.impliedDiscountPercent}% off — that works as your intro offer.`,
  };
};

export const suggestIntroOffer = (
  db: DbConnection,
  input: SuggestIntroOfferInput
) =>
  trackedResult(
    'claire.suggestIntroOffer',
    () => suggestIntroOfferImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
      },
      internalErrorsOnly: true,
    }
  );

export type SuggestIntroOfferResult = Awaited<
  ReturnType<typeof suggestIntroOffer>
>;
