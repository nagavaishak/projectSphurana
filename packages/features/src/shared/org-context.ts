// Back-compat shim. The organization-context plumbing moved into the stable
// `./core/org-context.js` as part of splitting shared into an extractable core.
// Existing importers use `../../../shared/org-context.js`; this re-export keeps
// them working unchanged.
//
// `getOrgCurrency` is re-exported from the domain-flavored
// `./currency-for-country.js` (it depends on currency logic that stays out of
// the core), so `import { getOrgCurrency } from '../../../shared/org-context.js'`
// continues to resolve.

export {
  getOrgCountry,
  getOrgContext,
  buildOrgContextBlock,
  type OrgContext,
  type OrgServiceContext,
} from './core/org-context.js';

export { getOrgCurrency } from './currency-for-country.js';
