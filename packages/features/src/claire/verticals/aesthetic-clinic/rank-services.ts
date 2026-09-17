import type { OrganizationService } from '@borradh-workspace/database';
import type { Axes, RankServicesInput, RankedServiceBase } from '../types.js';
import { deriveClinicType } from './derive-clinic-type.js';
import {
  type ServiceTaxonomyEntry,
  extractPriceCents,
  taxonomiseService,
} from './service-taxonomy.js';

const WEIGHTS = {
  retention: 0.4,
  barrier: 0.3,
  crossSell: 0.2,
  compliance: 0.1, // subtracted, not added
} as const;

const clamp = (value: number, min = 0, max = 1): number =>
  Math.max(min, Math.min(max, value));

const retentionFit = (axes: Axes, entry: ServiceTaxonomyEntry): number => {
  switch (axes.retentionModel) {
    case 'course_based':
      if (entry.cadence === 'course_based') return 1.0;
      if (entry.cadence === 'rebooking') return 0.4;
      if (entry.cadence === 'consideration_sale') return 0.1;
      if (entry.cadence === 'impulse') return 0.6;
      return 0.5;
    case 'rebooking':
      if (entry.cadence === 'rebooking') return 1.0;
      if (entry.cadence === 'course_based') return 0.6;
      if (entry.cadence === 'impulse') return 0.5;
      if (entry.cadence === 'consideration_sale') return 0.1;
      return 0.5;
    case 'consideration_sale':
      // For surgical / major-procedure clinics, only consideration_sale
      // services are advertisable on cold traffic. Mismatched services get
      // a hard zero so they don't ride a cheap-barrier score to the top.
      if (entry.cadence === 'consideration_sale') return 1.0;
      return 0;
  }
};

const crossSellScore = (entry: ServiceTaxonomyEntry): number => {
  if (entry.isPremiumUpgrade) return 0.2; // 2nd/3rd visit purchases
  if (entry.isSurgical) return 0.3; // one-and-done
  if (entry.isFirstTrustBuilder) return 0.9; // gateway to everything else
  if (entry.cadence === 'rebooking') return 0.5; // standalone, modest pull-through
  if (entry.cadence === 'course_based') return 0.7; // recurring revenue + upsell window
  if (entry.cadence === 'impulse') return 0.6;
  return 0.5;
};

const complianceRisk = (entry: ServiceTaxonomyEntry): number => {
  if (entry.isPOM) return 1.0; // cannot be advertised — full penalty
  if (entry.isOutcomeClaimHeavy) return 0.5;
  return 0.0;
};

const computeBarrierToEntry = (
  prices: Array<number | undefined>,
  ownPrice: number | undefined
): number => {
  const known = prices.filter((p): p is number => typeof p === 'number');
  if (known.length === 0 || ownPrice === undefined) return 0.5;
  if (known.length === 1) return 1.0; // only price in the menu

  const min = Math.min(...known);
  const max = Math.max(...known);
  if (max === min) return 1.0;

  // Cheapest → 1.0, most expensive → 0.0
  return clamp(1 - (ownPrice - min) / (max - min));
};

// Flagship score — the INVERSE of barrier-to-entry, scoped to surgical
// procedures. For a doctor-led / surgical clinic the right cold-traffic hero is
// the signature high-ticket procedure (the thing only a surgeon does), NOT the
// cheapest one. `barrier` favours the cheapest, so for surgical entries we swap
// in this term: most expensive surgical → 1.0, cheapest → 0.0.
//
// `surgicalPrices` is the set of prices among surgical services only, so a cheap
// non-surgical add-on in the menu can't distort the flagship scale.
const computeFlagshipScore = (
  surgicalPrices: Array<number | undefined>,
  ownPrice: number | undefined
): number => {
  const known = surgicalPrices.filter(
    (p): p is number => typeof p === 'number'
  );
  if (known.length === 0 || ownPrice === undefined) return 0.5;
  if (known.length === 1) return 1.0; // only surgical price in the menu

  const min = Math.min(...known);
  const max = Math.max(...known);
  if (max === min) return 1.0;

  // Most expensive surgical → 1.0, cheapest → 0.0.
  return clamp((ownPrice - min) / (max - min));
};

export const rankServices = (input: RankServicesInput): RankedServiceBase[] => {
  const { axes, services, verticalMetadata } = input;
  if (services.length === 0) return [];

  // The engine now branches on a first-class derived clinic type rather than
  // axes + price alone. This is what lets us express the two cases the price
  // model can't: Surgical (prefer the flagship, A1) and Beauty (prefer the head
  // spa, A2).
  const clinicType = deriveClinicType(axes, verticalMetadata, services);

  const taxonomised = services.map((service) => ({
    service,
    entry: taxonomiseService(service),
    priceCents: extractPriceCents(service),
  }));

  const allPrices = taxonomised.map((t) => t.priceCents);

  // A1 — for doctor_surgical clinics, the only differentiator among surgical
  // services is `barrier`, which favours the CHEAPEST. Invert it: rank by a
  // flagship score (most expensive surgical → top). Scope the price scale to
  // surgical entries only.
  const surgicalPrices = taxonomised
    .filter((t) => t.entry.isSurgical)
    .map((t) => t.priceCents);

  const scored = taxonomised.map(({ service, entry, priceCents }) => {
    const retention = retentionFit(axes, entry);
    // For surgical entries at a doctor_surgical clinic, swap the barrier term
    // (cheapest-first) for the flagship term (most-expensive-first).
    const barrier =
      clinicType === 'doctor_surgical' && entry.isSurgical
        ? computeFlagshipScore(surgicalPrices, priceCents)
        : computeBarrierToEntry(allPrices, priceCents);
    const crossSell = crossSellScore(entry);
    const compliance = complianceRisk(entry);

    const score = clamp(
      WEIGHTS.retention * retention +
        WEIGHTS.barrier * barrier +
        WEIGHTS.crossSell * crossSell -
        WEIGHTS.compliance * compliance,
      // Floor at 0 — a 100% POM penalty can otherwise produce a negative
      // raw score. Negative scores aren't comparable across services in a
      // user-facing way.
      0,
      1
    );

    // A2 — for beauty_therapist clinics that aren't above-market, pin the head
    // spa (the demand-wave treatment) to the top. We mark it here and apply the
    // pin in the sort comparator so the rest of the ranking is untouched when
    // there's no head spa / the clinic is above-market.
    const isPinnedHeadSpa =
      clinicType === 'beauty_therapist' &&
      axes.marketPosition !== 'above' &&
      entry.canonical === 'head_spa';

    return {
      service,
      entry,
      priceCents,
      criteriaScores: {
        retentionFit: clamp(retention),
        barrierToEntry: clamp(barrier),
        crossSell: clamp(crossSell),
        complianceRisk: clamp(compliance),
      },
      score,
      isPinnedHeadSpa,
    };
  });

  // Sort by pin first (A2 head-spa), then score desc; tie-break on barrier
  // (cheaper first) then name for stable, deterministic output.
  scored.sort((a, b) => {
    if (a.isPinnedHeadSpa !== b.isPinnedHeadSpa) {
      return a.isPinnedHeadSpa ? -1 : 1;
    }
    if (b.score !== a.score) return b.score - a.score;
    if (b.criteriaScores.barrierToEntry !== a.criteriaScores.barrierToEntry) {
      return b.criteriaScores.barrierToEntry - a.criteriaScores.barrierToEntry;
    }
    return a.service.name.localeCompare(b.service.name);
  });

  return scored.map((row, idx) => ({
    serviceId: row.service.id,
    rank: idx + 1,
    score: row.score,
    criteriaScores: row.criteriaScores,
    marketPosition: axes.marketPosition,
    objections: [],
  }));
};

// Test-only helper — exposes the per-service categorisation so unit tests can
// assert canonical names without re-parsing.
export const _taxonomiseForTest = (service: OrganizationService) =>
  taxonomiseService(service);
