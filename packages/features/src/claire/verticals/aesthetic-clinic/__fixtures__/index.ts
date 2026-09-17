import type { OrganizationService } from '@borradh-workspace/database';

const baseTimestamp = new Date('2026-01-01T00:00:00.000Z');

let counter = 0;
const nextId = () => `svc_${++counter}`;

const make = (
  overrides: Partial<OrganizationService> & {
    name: string;
    priceText?: string | null;
  }
): OrganizationService => ({
  id: overrides.id ?? nextId(),
  organizationId: overrides.organizationId ?? 'org_test',
  name: overrides.name,
  description: overrides.description ?? null,
  category: overrides.category ?? 'treatment',
  sortOrder: overrides.sortOrder ?? 0,
  isCustom: overrides.isCustom ?? false,
  isActive: overrides.isActive ?? true,
  requiresDeposit: overrides.requiresDeposit ?? false,
  depositAmountCents: overrides.depositAmountCents ?? null,
  // Null = inherit the org's payment policy, which is what an unconfigured
  // service does in production.
  paymentPolicy: overrides.paymentPolicy ?? null,
  depositBasis: overrides.depositBasis ?? null,
  depositPercent: overrides.depositPercent ?? null,
  painPoints: overrides.painPoints ?? null,
  expectedResults: overrides.expectedResults ?? null,
  processDescription: overrides.processDescription ?? null,
  targetArea: overrides.targetArea ?? null,
  priceText: overrides.priceText ?? null,
  priceCents: overrides.priceCents ?? null,
  // Null means this fixture uses the clinic's Stripe Tax preset, just like an
  // existing service that has not chosen a per-service override.
  taxCode: overrides.taxCode ?? null,
  priceType: overrides.priceType ?? 'poa',
  categoryId: overrides.categoryId ?? null,
  appointmentDuration: overrides.appointmentDuration ?? null,
  turnaroundMinutes: overrides.turnaroundMinutes ?? null,
  // Footage spec. Defaults mirror a service that has never been specced —
  // which is the state 100% of production services start in.
  regions: overrides.regions ?? [],
  specSource: overrides.specSource ?? 'unknown',
  expectedShot: overrides.expectedShot ?? null,
  expectedShotEmbedding: overrides.expectedShotEmbedding ?? null,
  techniqueSlug: overrides.techniqueSlug ?? null,
  techniqueClassifiedAt: overrides.techniqueClassifiedAt ?? null,
  createdAt: overrides.createdAt ?? baseTimestamp,
  updatedAt: overrides.updatedAt ?? baseTimestamp,
});

const resetCounter = () => {
  counter = 0;
};

// ── Nurse-led injectable clinic ───────────────────────────────────────
export const nurseLedClinicServices = (): OrganizationService[] => {
  resetCounter();
  return [
    make({ name: 'Microneedling', priceText: '€180 per session' }),
    make({ name: 'Skin Boosters', priceText: '€250 per session' }),
    make({ name: 'Anti-Wrinkle Injections', priceText: '€200' }),
    make({ name: 'Lip Filler', priceText: '€300' }),
    make({ name: 'Chemical Peel', priceText: '€120' }),
    make({ name: 'Polynucleotides', priceText: '€350' }),
  ];
};

// ── Surgical / doctor-led ─────────────────────────────────────────────
export const surgicalClinicServices = (): OrganizationService[] => {
  resetCounter();
  return [
    make({ name: 'Liposuction', priceText: '€4500' }),
    make({ name: 'Rhinoplasty', priceText: '€6000' }),
    make({ name: 'Anti-Wrinkle Injections', priceText: '€200' }),
    make({ name: 'Microneedling', priceText: '€150' }),
  ];
};

// ── Beauty therapist (no medical qualifications) ──────────────────────
export const beautyTherapistServices = (): OrganizationService[] => {
  resetCounter();
  return [
    make({ name: 'Signature Facial', priceText: '€80' }),
    make({ name: 'Brow Shaping', priceText: '€35' }),
    make({ name: 'Dermaplaning', priceText: '€60' }),
    make({ name: 'Microneedling', priceText: '€100' }),
    make({ name: 'Head Spa', priceText: '€120' }),
  ];
};

// ── Body-contouring dominant ──────────────────────────────────────────
export const bodyContouringServices = (): OrganizationService[] => {
  resetCounter();
  return [
    make({ name: 'Fat Dissolving Small Area', priceText: '€70' }),
    make({ name: 'Fat Dissolving Large Area', priceText: '€140' }),
    make({ name: 'Ultrasonic Cavitation', priceText: '€60' }),
    make({ name: 'RF Skin Tightening', priceText: '€90' }),
  ];
};

// ── Above-market clinic (all premium pricing) ─────────────────────────
export const aboveMarketClinicServices = (): OrganizationService[] => {
  resetCounter();
  return [
    make({ name: 'Profhilo', priceText: '€450' }),
    make({ name: 'Polynucleotides', priceText: '€500' }),
    make({ name: 'Thread Lift', priceText: '€1200' }),
  ];
};

export { make as makeService };
