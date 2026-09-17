import {
  listMembershipPlansResponseSchema,
  listServicesResponseSchema,
  packageWithItemsSchema,
} from '@borradh-workspace/contracts';
import type {
  CatalogPort,
  ListSellablesInput,
  ListSellablesResult,
  Sellable,
  SellableKind,
  SellablePrice,
  SellableSource,
} from '@borradh-workspace/contracts/ports';
import { membershipValidForLabels } from '@borradh-workspace/labels';
import { z } from 'zod';
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

export interface CatalogPortDeps {
  apiFetch: ApiFetchFn;
}

/**
 * A 4xx is the API stating a reason; anything else is the server breaking.
 * Only the fault side may reach Sentry — collapsing the two is what made
 * ordinary "no, because…" answers page someone.
 */
function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

/**
 * `GET /packages` returns a bare array of the service-joined package
 * projection. Contracts exports the element schema but not the list wrapper,
 * so it is composed here from the existing schema rather than re-declared.
 */
const listPackagesResponseSchema = z.array(packageWithItemsSchema);

const KIND_SOURCE: Record<SellableKind, SellableSource> = {
  service: 'services',
  package: 'packages',
  membership: 'memberships',
};

const ALL_KINDS: SellableKind[] = ['service', 'package', 'membership'];

/**
 * Map a service's structured price onto the pricing union.
 *
 * The four `priceType` values do not map one-to-one: `fixed` and `from` both
 * need an amount, and a row that declares one without carrying it is a DATA
 * GAP, not a price of zero. That case becomes `unpriced` rather than `free`,
 * because a model told a treatment is free will say so out loud.
 */
function servicePrice(s: {
  priceType: string;
  priceCents: number | null;
  priceText: string | null;
}): SellablePrice {
  switch (s.priceType) {
    case 'free':
      return { model: 'free' };
    case 'poa':
      return { model: 'on_consultation' };
    case 'from':
      return s.priceCents === null
        ? {
            model: 'unpriced',
            declaredType: s.priceType,
            legacyText: s.priceText,
          }
        : { model: 'from', fromAmountCents: s.priceCents };
    default:
      return s.priceCents === null
        ? {
            model: 'unpriced',
            declaredType: s.priceType,
            legacyText: s.priceText,
          }
        : { model: 'one_off', amountCents: s.priceCents };
  }
}

/**
 * Catalog port — see `packages/contracts/src/ports/catalog.port.ts` for why a
 * price list composed from three reads must distinguish "that is everything"
 * from "that is what I could see", and why the three pricing models stay in
 * separate union members instead of one `price` number.
 *
 * Every read is PARSED against its contract schema rather than asserted, so a
 * projection that drifts fails here instead of silently yielding `undefined`
 * prices that read as free.
 */
export function createCatalogPort(deps: CatalogPortDeps): CatalogPort {
  const { apiFetch } = deps;

  return {
    async listSellables(
      input: ListSellablesInput
    ): Promise<ListSellablesResult> {
      const { kinds, includeInactive = false } = input;

      if (kinds && kinds.length === 0) {
        // An empty selection is not "nothing is for sale" — that reading is
        // exactly the wrong answer to hand a salesperson.
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_input',
            message: 'kinds was empty — omit it to list everything.',
          },
        };
      }

      const wanted = kinds ?? ALL_KINDS;
      const unknown = wanted.filter((k) => !ALL_KINDS.includes(k));
      if (unknown.length > 0) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_input',
            message: `Unknown sellable kind(s): ${unknown.join(', ')}.`,
          },
        };
      }

      const requested = new Set(wanted);
      const requestedSources = wanted.map((k) => KIND_SOURCE[k]);

      const sellables: Sellable[] = [];
      const read: SellableSource[] = [];
      const unread: SellableSource[] = [];
      /** A fault on EVERY requested source is a blocked result; a fault on
       *  some is a partial read. */
      let firstFault: string | undefined;

      const keep = (isActive: boolean) => includeInactive || isActive;

      // ---- services --------------------------------------------------------
      if (requested.has('service')) {
        try {
          const data = await apiFetch('organization-services?limit=100', {
            schema: listServicesResponseSchema,
          });
          for (const s of data.items) {
            if (!keep(s.isActive)) continue;
            sellables.push({
              kind: 'service',
              id: s.id,
              name: s.name,
              description: s.description,
              isActive: s.isActive,
              price: servicePrice(s),
              // The services projection carries no currency — the org display
              // currency applies, and this port does not guess it.
              currencyCode: null,
              durationMinutes: s.appointmentDuration,
              options: s.variants
                .filter((v) => keep(v.isActive))
                .map((v) => ({
                  name: v.name,
                  priceCents: v.priceCents,
                  durationMinutes: v.durationMinutes,
                })),
              includedServiceIds: [],
            });
          }
          read.push('services');
        } catch (error) {
          unread.push('services');
          if (isServerFault(error)) firstFault ??= messageOf(error);
        }
      }

      // ---- packages --------------------------------------------------------
      if (requested.has('package')) {
        try {
          const data = await apiFetch('packages', {
            schema: listPackagesResponseSchema,
          });
          for (const p of data) {
            if (!keep(p.isActive)) continue;
            const items = p.items ?? [];
            sellables.push({
              kind: 'package',
              id: p.id,
              name: p.name,
              description: p.description,
              isActive: p.isActive,
              price: {
                model: 'bundle',
                amountCents: p.priceCents,
                // Total sessions in the bundle, not the number of DISTINCT
                // services — "six treatments" is what makes the bundle
                // comparable against the single-visit price.
                itemCount: items.reduce((n, i) => n + i.quantity, 0),
                validityDays: p.validityDays,
              },
              currencyCode: null,
              durationMinutes: null,
              options: [],
              includedServiceIds: [...new Set(items.map((i) => i.serviceId))],
            });
          }
          read.push('packages');
        } catch (error) {
          unread.push('packages');
          if (isServerFault(error)) firstFault ??= messageOf(error);
        }
      }

      // ---- memberships -----------------------------------------------------
      if (requested.has('membership')) {
        try {
          const data = await apiFetch('membership-plans', {
            schema: listMembershipPlansResponseSchema,
          });
          for (const m of data) {
            if (!keep(m.isActive)) continue;
            const label =
              membershipValidForLabels[
                m.validFor as keyof typeof membershipValidForLabels
              ] ?? m.validFor;
            sellables.push({
              kind: 'membership',
              id: m.id,
              name: m.name,
              description: m.description,
              isActive: m.isActive,
              // The one branch that must never collapse: `recurring` is a
              // charge that repeats until cancelled, `one_time` is a single
              // payment covering a term. Same number, different sale.
              price:
                m.pricingType === 'recurring'
                  ? {
                      model: 'recurring',
                      amountCents: m.priceCents,
                      sessionCount: m.sessionCount,
                      period: m.validFor,
                      periodLabel: label,
                    }
                  : {
                      model: 'prepaid_term',
                      amountCents: m.priceCents,
                      sessionCount: m.sessionCount,
                      term: m.validFor,
                      termLabel: label,
                    },
              currencyCode: m.currency,
              durationMinutes: null,
              options: [],
              includedServiceIds: m.serviceIds,
            });
          }
          read.push('memberships');
        } catch (error) {
          unread.push('memberships');
          if (isServerFault(error)) firstFault ??= messageOf(error);
        }
      }

      // Every requested source failed — we learned nothing, which is not a
      // partial read of the catalogue.
      if (unread.length === requestedSources.length) {
        return {
          status: 'blocked',
          reason: firstFault
            ? { kind: 'server_error', message: firstFault }
            : {
                kind: 'other',
                message: 'None of the catalogue sources could be read.',
              },
        };
      }

      if (unread.length > 0) {
        return { status: 'partially_read', sellables, read, unread };
      }

      return { status: 'read', sellables, read };
    },
  };
}
