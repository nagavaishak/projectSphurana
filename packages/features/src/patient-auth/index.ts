/**
 * Patient portal auth (ENG-647 / Portal v2) — the clinic's CUSTOMER, not
 * clinic staff.
 *
 * A second principal type, PASSWORDLESS (email OTP / magic link), backed by a
 * dedicated Better Auth instance (`@borradh-workspace/auth/patient`). One
 * email = one universal `customer_account` (the BA user), silently linked
 * across clinics; `patient_auth` is the per-org membership (1:1 off the `lead`
 * row) — the domain join BA knows nothing about. This layer holds only the
 * domain logic: eligibility/non-enumeration, membership resolution, the
 * org-pinned session validation, and the org-bound magic-link mint.
 */
export * from './services/index.js';
export { buildPortalAccessUrl, buildPortalHomeUrl } from './lib/index.js';
// Re-exported beside the builders it feeds — see the note in
// `appointments/index.ts`.
export {
  type MicrositeLinkTarget,
  resolveMicrositeLinkTarget,
  resolveMicrositeLinkTargets,
} from '../shared/microsite-host.js';
