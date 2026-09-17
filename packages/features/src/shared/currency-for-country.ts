/**
 * Resolve the display currency for an org's marketing copy from its country.
 *
 * The pure symbol/code logic (`Currency`, `currencyForCountry`,
 * `currencyForCode`, `formatPrice`) lives in `./currency.js` so it can be
 * shared with the frontend without dragging the DB in. This module adds the
 * DB-backed `getOrgCurrency`, which reads the org's primary location country
 * (the only country we store, on `organizationLocation.country`) and maps it
 * via `currencyForCountry`. Historically the symbol was hardcoded to "€", which
 * rendered a euro symbol for US/UK orgs whose prices are really dollars/pounds
 * (see the "graphic says € but copy says $" bug).
 */

import { getOrgCountry } from './core/org-context.js';
import type { DbConnection } from './core/types.js';
import { currencyForCountry } from './currency.js';

// Re-export the pure helpers so existing importers of this module keep working.
export {
  currencyForCode,
  currencyForCountry,
  currencyMinorUnitDigits,
  formatPrice,
  type Currency,
} from './currency.js';

/**
 * The display currency for an org's marketing copy, derived from its primary
 * location country. Falls back to EUR when no location/country is known.
 *
 * Lives here (not in the pure `currency.ts`) because it depends on org data,
 * which is domain-flavored and stays out of the frontend-safe surface.
 */
export async function getOrgCurrency(db: DbConnection, organizationId: string) {
  return currencyForCountry(await getOrgCountry(db, organizationId));
}
