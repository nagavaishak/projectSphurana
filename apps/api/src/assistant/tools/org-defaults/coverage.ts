import { defineCoverage } from '../coverage.types.js';

/**
 * ORG-DEFAULTS — 2 endpoints, 1 tool. The org's remembered preferences: default
 * ad budget, default tone, the settings Claire falls back on when the owner
 * does not restate them. Values are resolved against system fallbacks, and an
 * `overrides` map marks which are genuinely org-specific.
 *
 * Two endpoints, and the pair is lopsided in an instructive way.
 * `org_defaults_setOrgDefault` can WRITE a default but nothing reads one back,
 * so Claire can be told "always use €20 a day" and then cannot answer "what's
 * my default budget?" — write-only memory. The PATCH returns the newly resolved
 * set, which papers over it only for the turn that did the writing.
 */
export const orgDefaultsCoverage = defineCoverage('org-defaults', {
  // ---- reads -------------------------------------------------------------
  // The missing half of the pair: Claire sets defaults she cannot recite.
  'GET /org-defaults': { undecided: 'ENG-CLAIRE-ORG-DEFAULTS-READ' },

  // ---- writes ------------------------------------------------------------
  // Unconfirmed by design (the tool declares `destructive: false`): it writes
  // to a settings row only — no spend, no publishing, no customer-visible
  // effect — and each key is independently reversible by setting it again.
  'PATCH /org-defaults': {
    exposed: 'org_defaults_setOrgDefault',
    confirm: false,
  },
});
