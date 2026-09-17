/**
 * The org's FULL service catalogue, in one call.
 *
 * `GET /organization-services` pages: it defaults to `limit=10` and its schema
 * caps `limit` at 100 (`list-services.schema.ts`). Both callers here need the
 * whole catalogue, not a page:
 *
 *   - `context_listServices` — Claire looks a service up BY NAME. A name past
 *     the cap reads as "you don't offer that".
 *   - `noHallucinatedService` (hard block) — proves an id is real by absence
 *     from the set. A truncated set turns a legitimate service into a
 *     "hallucinated" one and hard-blocks a real ad. That is the one direction
 *     a fail-open validator must never fail.
 *
 * So page until the catalogue is exhausted rather than asking for a bigger
 * page — the 100 cap is the endpoint's public contract and stays put.
 */

import {
  type ListedService,
  listServicesResponseSchema,
} from '@borradh-workspace/contracts';
import type { ApiFetchFn } from './api-fetch.js';

/** The list endpoint's maximum `limit` (`list-services.schema.ts`). */
const PAGE_SIZE = 100;

/**
 * Backstop against an unbounded loop if `total` ever disagrees with what the
 * endpoint actually returns. 50 pages = 5,000 services, far beyond any real
 * catalogue; a caller that hits it gets what was fetched so far.
 */
const MAX_PAGES = 50;

export interface ServiceCatalogue {
  items: ListedService[];
  /** `total` as reported by the last page fetched. */
  total: number;
  /**
   * False when the page cap cut the walk short — i.e. `items` is NOT the whole
   * catalogue. Callers that reason from ABSENCE (the hard block) must treat an
   * incomplete catalogue as "can't prove anything" rather than as proof an id
   * is fake.
   */
  complete: boolean;
}

/**
 * Fetch every service the org has, following pagination.
 *
 * Throws whatever `apiFetch` throws (`ApiFetchError` /
 * `ApiResponseContractError`) — including on a later page, so a partial walk
 * never silently masquerades as a complete catalogue.
 */
export async function fetchServiceCatalogue(
  apiFetch: ApiFetchFn
): Promise<ServiceCatalogue> {
  const items: ListedService[] = [];
  let total = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await apiFetch(
      `organization-services?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`,
      { schema: listServicesResponseSchema }
    );
    items.push(...res.items);
    total = res.total;

    // A short page means we reached the end; `items.length >= total` covers the
    // exact-multiple case where the next page would come back empty.
    if (res.items.length < PAGE_SIZE || items.length >= total) {
      return { items, total, complete: true };
    }
  }

  return { items, total, complete: false };
}
