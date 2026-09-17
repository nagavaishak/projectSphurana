import type {
  CreateServiceInput,
  PractitionerWithRelations,
  UpdateServiceInput,
} from '@borradh-workspace/api-client/types';
import type { ServicePriceType } from '@borradh-workspace/labels';

import { parseMajorToCents } from '@/lib/org-currency';

import {
  type ServiceFormValues,
  priceAmountToCents,
} from './service-form-schema';

/** The API accepts a deposit amount ≥ €1 (min 100 cents). */
const MIN_DEPOSIT_CENTS = 100;

/**
 * Resolve the per-service deposit for the wire. Off → no deposit, no amount.
 * On → `requiresDeposit: true`; the amount is sent only when it clears the
 * server's €1 floor (a blank or sub-€1 amount persists as null, which the
 * backend reads as "deposit required, amount not set").
 */
function resolveDeposit(values: ServiceFormValues): {
  requiresDeposit: boolean;
  paymentPolicy: 'in_clinic' | 'deposit';
  depositAmountCents: number | null;
  depositBasis: 'fixed' | 'percent' | null;
  depositPercent: number | null;
} {
  if (!values.requiresDeposit) {
    return {
      requiresDeposit: false,
      // Explicit opt-out, not null: the user actively turned the deposit OFF
      // for this service, which must beat an org default that says otherwise.
      paymentPolicy: 'in_clinic',
      depositAmountCents: null,
      depositBasis: null,
      depositPercent: null,
    };
  }
  const cents = parseMajorToCents(values.depositAmount);
  const percent = Number.parseInt(values.depositPercent, 10);
  return {
    requiresDeposit: true,
    paymentPolicy: 'deposit',
    depositAmountCents:
      cents != null && cents >= MIN_DEPOSIT_CENTS ? cents : null,
    // `inherit` is null on the wire: no override, so the org default applies.
    // Both amounts are sent regardless of basis — the resolver reads only the
    // one the basis selects, and keeping the other means switching back does
    // not wipe what was typed.
    depositBasis:
      values.depositBasis === 'inherit' ? null : values.depositBasis,
    depositPercent:
      Number.isFinite(percent) && percent > 0 && percent <= 100
        ? percent
        : null,
  };
}

/**
 * The structured price the service persists: `priceType` + `priceCents` (integer
 * cents, or null for free/POA/"from" with no floor). The freeform `priceText` is
 * DEAD — display is always derived from these via `formatServicePrice`.
 *
 * When a service has ≥1 variant the caller passes an override here: `from` +
 * the cheapest variant's cents (the "from" floor). Otherwise it is derived from
 * the form's own price type + amount.
 */
export interface ServicePricePayload {
  priceType: ServicePriceType;
  priceCents: number | null;
}

function resolvePrice(
  values: ServiceFormValues,
  override?: ServicePricePayload
): ServicePricePayload {
  if (override) return override;
  return {
    priceType: values.priceType,
    priceCents: priceAmountToCents(values.priceType, values.priceAmount),
  };
}

/**
 * The ONLY place a create/update service payload is constructed.
 *
 * Both the desktop wizard and the mobile funnel (and onboarding's service
 * setup) build their request bodies here so the two surfaces cannot drift
 * apart again. If you need a new field on the wire, add it here.
 *
 * Deposit fields (`requiresDeposit` / `depositAmountCents`) are collected on the
 * form's pricing step (see `ServiceDepositField`) and resolved by
 * `resolveDeposit`. NOTE: the booking-form checkout still charges the deposit at
 * the ORG level (`org.depositEnabled`); this per-service flag feeds the chatbot
 * + public booking config.
 */

export function buildCreateServicePayload(
  values: ServiceFormValues,
  priceOverride?: ServicePricePayload
): CreateServiceInput {
  const description = values.description.trim();
  const price = resolvePrice(values, priceOverride);
  const deposit = resolveDeposit(values);

  return {
    name: values.name.trim(),
    description: description || undefined,
    categoryId: values.categoryId || undefined,
    // Legacy enum kept populated until Phase 5 of the catalog cutover removes it.
    category: 'treatment',
    appointmentDuration: values.durationMinutes,
    priceType: price.priceType,
    priceCents: price.priceCents,
    taxCode: values.taxCode?.trim() || null,
    sortOrder: 0,
    isCustom: true,
    isActive: true,
    requiresDeposit: deposit.requiresDeposit,
    paymentPolicy: deposit.paymentPolicy,
    depositAmountCents: deposit.depositAmountCents,
    depositBasis: deposit.depositBasis,
    depositPercent: deposit.depositPercent,
  };
}

export function buildUpdateServicePayload(
  serviceId: string,
  values: ServiceFormValues,
  priceOverride?: ServicePricePayload
): UpdateServiceInput & { id: string } {
  const description = values.description.trim();
  const price = resolvePrice(values, priceOverride);
  const deposit = resolveDeposit(values);

  return {
    id: serviceId,
    name: values.name.trim(),
    description: description || null,
    categoryId: values.categoryId || null,
    appointmentDuration: values.durationMinutes,
    priceType: price.priceType,
    priceCents: price.priceCents,
    taxCode: values.taxCode?.trim() || null,
    requiresDeposit: deposit.requiresDeposit,
    paymentPolicy: deposit.paymentPolicy,
    depositAmountCents: deposit.depositAmountCents,
    depositBasis: deposit.depositBasis,
    depositPercent: deposit.depositPercent,
  };
}

export interface PractitionerServiceAssignment {
  practitionerId: string;
  serviceIds: string[];
}

/**
 * Reconcile the practitioner ⇄ service links for `serviceId`.
 *
 * Works for both create (nobody has the service yet, so this only ever adds)
 * and edit (adds the newly-ticked, removes the newly-unticked). Practitioners
 * whose assignment is unchanged produce no request.
 */
export function buildPractitionerAssignments({
  serviceId,
  practitioners,
  selectedPractitionerIds,
}: {
  serviceId: string;
  practitioners: PractitionerWithRelations[];
  selectedPractitionerIds: string[];
}): PractitionerServiceAssignment[] {
  const selected = new Set(selectedPractitionerIds);
  const assignments: PractitionerServiceAssignment[] = [];

  for (const practitioner of practitioners) {
    const existing = practitioner.services?.map((s) => s.serviceId) ?? [];
    const hasService = existing.includes(serviceId);
    const isSelected = selected.has(practitioner.id);

    if (isSelected && !hasService) {
      assignments.push({
        practitionerId: practitioner.id,
        serviceIds: [...existing, serviceId],
      });
    } else if (!isSelected && hasService) {
      assignments.push({
        practitionerId: practitioner.id,
        serviceIds: existing.filter((id) => id !== serviceId),
      });
    }
  }

  return assignments;
}
