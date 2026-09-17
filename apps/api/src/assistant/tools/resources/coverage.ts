import { defineCoverage } from '../coverage.types.js';

/**
 * RESOURCES (rooms & equipment) — 13 endpoints, 0 tools, 1 capability port.
 *
 * The area is new, so `undecided` is not available to it: this file is being
 * written in the same commit as the routes, which makes its author the person
 * who knows. Every entry below is therefore a decision, and the decision is
 * the same one for all thirteen — with a reason that is about SHAPE, not about
 * appetite.
 *
 * WHAT IS AND IS NOT REACHABLE. The mutating half of this area IS ported:
 * `ResourcesPort` (`packages/contracts/src/ports/resources.port.ts`) covers
 * every write, and the composition root implements it. Rooms are the SECOND
 * availability source after shifts, so Gate 1's founding sentence — "shifts
 * are the sole availability source, so Claire structurally could not fix an
 * unbookable service" — applies verbatim the moment a service requires a room.
 * The capability exists.
 *
 * WHY NO TOOL PER ROUTE. Thirteen tools mapping one-to-one onto thirteen
 * routes is precisely the shape `availability.port.ts` argues against: "Four
 * tools returning four bags could not express that: each would succeed or fail
 * on its own, and the CONCLUSION drawn across them would live in the model's
 * head, where nothing checks it." Rooms are worse, not better, for this,
 * because a write here can succeed at the row level and STILL leave a service
 * unbookable — a deactivated room, a schedule with no open day, a requirement
 * pointing at an empty category. All three return 200. A per-route tool would
 * report each as success and be right about the row and wrong about the
 * clinic.
 *
 * So the intended path to the chat surface is a COMPOSED tool over the port —
 * the same move `GET /shifts` made when it became `shifts_explainAvailability`
 * rather than a rota dump. When that tool is written, these entries become
 * `exposed:` naming it, and the writes will have to declare `confirm`.
 */
export const resourcesCoverage = defineCoverage('resources', {
  // ── Reads ────────────────────────────────────────────────────────────────
  'GET /resources': {
    notExposed:
      "The room list read alone answers nothing an owner asks. \"Why can't customers book X?\" needs it joined to the service's requirements and to each room's active/hours state — the join `ResourcesPort` already performs. Exposed as a raw list it invites the model to conclude a room is bookable from its mere existence.",
  },
  'GET /resources/categories': {
    notExposed:
      'A category is only meaningful next to the resources in it: an empty "Lasers" category and a full one look identical here, and the empty one is the failure. Belongs inside the composed answer, not as a standalone list.',
  },
  'GET /resources/requirements/:serviceId': {
    notExposed:
      "Reads the rules but not whether anything can satisfy them, which is the only question worth asking of them. Satisfiability needs the live resource list joined in; that is `ResourcesPort.setServiceRequirements`'s verification step and belongs to the same composed tool.",
  },
  'GET /resources/utilisation': {
    notExposed:
      'A per-room occupancy and revenue report over an arbitrary window. Real analytics with a real audience, but it is a reporting surface rather than a scheduling capability, and no owner question routed to Claire today needs it. Revisit when room-level reporting is asked for by name.',
  },
  'GET /resources/allocations': {
    notExposed:
      'The calendar feed: every resource hold in a window, hydrated for rendering. It is a UI payload — potentially thousands of rows for a month — and Claire has no rendering surface for it. She reaches individual bookings through the appointments tools instead.',
  },

  // ── Writes. All ported; none individually exposed. ───────────────────────
  'POST /resources/categories': {
    notExposed:
      'Ported as `ResourcesPort.createCategory`. Withheld as a standalone tool because creating a category in isolation produces an EMPTY category, and an empty category that a service then requires is exactly how a service becomes unbookable. It is a step inside a setup flow, never an act on its own.',
  },
  'PUT /resources/categories/:id': {
    notExposed:
      'Ported as `ResourcesPort.updateCategory`. Deactivating a category silently withdraws every room in it from scheduling, so this needs a confirm story written against a composed tool that can state that consequence — not a rename tool that happens to also take `isActive`.',
  },
  'DELETE /resources/categories/:id': {
    notExposed:
      'Ported as `ResourcesPort.deleteCategory`. The server refuses while the category holds resources, so the destructive path always begins by deleting or moving rooms — a multi-step decision an owner should be walked through, not a single call.',
  },
  'POST /resources': {
    notExposed:
      'Ported as `ResourcesPort.createResource`. A room created with a working-hours record that names no open day is saved successfully and can never be booked; the port has a distinct result member for that, and a tool must be built to say it out loud before this is exposed.',
  },
  'PUT /resources/:id': {
    notExposed:
      'Ported as `ResourcesPort.updateResource` — the repair path for an unbookable service, since `isActive` and `workingHours` are the two fields that decide it. Held back only until a composed tool exists to report the after-state rather than echoing the write.',
  },
  'DELETE /resources/:id': {
    notExposed:
      'Ported as `ResourcesPort.deleteResource`. The server refuses while the room holds future bookings and points at deactivation instead; that redirection is a conversation, and it is the whole value of the call. A bare delete tool would surface it as a flat failure.',
  },
  'PUT /resources/reorder': {
    notExposed:
      'Display order in the settings list and the calendar column order. Presentation only — it cannot affect whether anything is bookable — so there is no owner question it answers and no reason to spend a tool slot on it.',
  },
  'PUT /resources/requirements/:serviceId': {
    notExposed:
      "Ported as `ResourcesPort.setServiceRequirements`, and the single most consequential write in the area: it replaces a service's ENTIRE rule set, and one rule naming a category with nothing allocatable in it makes that service unbookable on every date, immediately. The port verifies each rule against the live resource list before reporting success; a tool may only be exposed on top of that verification, with confirm.",
  },
});
