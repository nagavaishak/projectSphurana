/**
 * GATE 6 — the tool-coverage ratchet.
 *
 * `UNCOVERED_AREA_CEILING` used to live here and is GONE. It reached 0, so the
 * rule is now absolute: every route area has a `coverage.ts`, and a new one
 * fails the gate outright rather than against a number. Exactly the move Gate 5
 * made when it hit zero — a ceiling that has been earned to zero should stop
 * being a ceiling, or it silently re-licenses the thing it was retiring.
 *
 * What remains is the grandfather bucket.
 *
 * `undecided` exists so migrating 673 endpoints did not require inventing 673
 * reasons in an afternoon. Invented reasons are worse than none: they read as
 * decisions and stop anyone looking again. An endpoint written TODAY may not
 * use it — the gate takes the count, and the count may only fall.
 *
 * Lower this as capabilities land. When it reaches 0, delete it too and the
 * whole gate becomes absolute.
 */

/**
 * Endpoints parked as `undecided`. MEASURED 2026-07-27 by running the gate:
 * 673 endpoints across 75 areas — 101 exposed, 468 deliberately withheld, 104
 * undecided.
 *
 * They are not evenly spread, and the clusters are the roadmap:
 *
 *   availability      CLOSED, 2026-07-27. All four reads (shifts, opening
 *                     hours, blocked time, time off) are now served by
 *                     `shifts_explainAvailability` — one tool that composes
 *                     them into an answer to "why can't customers book?"
 *                     rather than four raw dumps. 115 -> 111.
 *   commerce          PARTLY CLOSED, 2026-07-27. `sales_getTakings` (takings
 *                     by tender, POS and deposits kept separate because
 *                     daily-summary cannot see deposit money at all),
 *                     `packages_listSellables` (services + packages +
 *                     memberships in one comparable shape) and
 *                     `practitioners_listTeam` (the only source of a
 *                     practitionerId, which bookAppointment and
 *                     explainAvailability both take and neither can invent).
 *                     READS ONLY — every commerce WRITE is still withheld:
 *                     refunds, sale creation and gift-card redemption each
 *                     need their own confirm design, not a sweep. 111 -> 105.
 *   integrations      six connection-status reads (stripe, calendar, booking,
 *                     email, GMB, instagram). Each one gates a flow she
 *                     already has.
 *   billing           plan / subscription / credits / currency. She reports a
 *                     channel as blocked without being able to say the plan is
 *                     why.
 *   content-batches   8 endpoints, zero tools.
 *
 *   chatbot toggles   CLOSED, Phase 8 of the Claire reliability overhaul.
 *                     The three per-channel chatbot PUT toggles became
 *                     `chatbots_setEnabled` (confirm: true) — finding #65's
 *                     urgent off-switch. 104 -> 101.
 */
export const UNDECIDED_CEILING = 101;
