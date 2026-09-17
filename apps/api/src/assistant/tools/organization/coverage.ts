import { defineCoverage } from '../coverage.types.js';

/**
 * ORGANIZATION — 5 endpoints, 0 tools. The SESSION-scoped view of the current
 * business: which org this session is pointed at, its settings, and the
 * onboarding checklist. (Its sibling `organizations` handles the org registry
 * and membership; this one is about "the org I am currently in".)
 *
 * The reads are the interesting subtlety. `GET /organization/active` looks like
 * an obvious exposure and is not one, because Claire already has a better
 * version of it: `context_getOrganizationContext` reads `GET
 * /assistant/context`, a payload shaped for the model rather than for the app
 * shell. Two routes answering "what business am I in?" is how a model ends up
 * quoting the wrong one.
 *
 * `POST /organization/active` is the endpoint to look at twice — it repoints
 * the session at a DIFFERENT business, and everything downstream silently
 * follows it.
 */
export const organizationCoverage = defineCoverage('organization', {
  // ---- reads -------------------------------------------------------------
  'GET /organization/active': {
    notExposed:
      'Superseded for Claire’s purposes by `GET /assistant/context`, which `context_getOrganizationContext` already reads and which is curated for the model. This route returns the session-bound row plus per-user calendar settings for the app shell to render; two sources of truth for "which business is this" is precisely how a model comes to quote the stale one.',
  },
  // The onboarding checklist is the spine of the Claire-led onboarding flow —
  // she cannot guide an owner through setup she cannot see the state of.
  'GET /organization/onboarding-tasks': {
    undecided: 'ENG-CLAIRE-ONBOARDING',
  },

  // ---- writes ------------------------------------------------------------
  // Org settings: trading name, deposits, notice windows, timezone. Real
  // conversational surface ("stop taking bookings less than 24h out"), and
  // admin-guarded, so it wants `confirm: true` if it lands.
  'PATCH /organization/active': { undecided: 'ENG-CLAIRE-ORG-SETTINGS' },
  // Ticking a setup step off as Claire completes it for the owner is the
  // natural companion to reading the checklist.
  'POST /organization/onboarding-tasks/complete': {
    undecided: 'ENG-CLAIRE-ONBOARDING',
  },

  'POST /organization/active': {
    notExposed:
      'Repoints the caller’s SESSION at a different organisation. Every subsequent tool call — every read, every booking, every message — would then act on another business without anything in the conversation marking the switch. Claire is scoped to the org she was invoked for, and this is the one call that could quietly break that.',
  },
});
