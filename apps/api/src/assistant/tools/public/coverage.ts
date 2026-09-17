import { defineCoverage } from '../coverage.types.js';

/**
 * PUBLIC — 17 endpoints, 0 tools. The UNAUTHENTICATED CUSTOMER-FACING surface:
 * the booking widget, the intake form and the venue page that a member of the
 * public loads after clicking a link.
 *
 * The distinction that decides this whole area is WHO these routes speak FOR.
 * Claire acts for the BUSINESS, inside its session. These act for a CUSTOMER,
 * scoped by an org slug in the path and — for anything touching an existing
 * booking — by a single-use signed token mailed to that one person. That token
 * is the only authorisation in the flow. Claire cannot hold one, and if she
 * could, holding it would mean she could cancel a stranger's appointment.
 *
 * The reads are not withheld for secrecy: the same facts are already reachable
 * on the authenticated side, in richer form. `context_listServices` returns the
 * structured pricing the public config flattens, and `appointments_findOpenSlots`
 * answers availability with the internal rules applied. Pointing Claire at the
 * public projection instead would give her a thinner answer by a longer route,
 * and two sources for one fact is how she ends up quoting the wrong price.
 *
 * The writes are the customer's own actions. A booking Claire submits through
 * the public form is a booking attributed to nobody, entering as `source:
 * public` and bypassing the manual-booking path that exists for staff.
 */
export const publicCoverage = defineCoverage('public', {
  // ---- shop --------------------------------------------------------------
  // Shop routes act for an anonymous purchaser: a cart, its email token and
  // eventually a payment are the customer's own actions, not the business
  // assistant's. Staff has an authenticated fulfilment surface instead.
  'GET /public/shop/:organizationSlug': {
    notExposed:
      'The anonymous storefront catalogue rendered to a shopper. Claire already works inside the clinic and has richer authenticated product data; this projection exists solely for the customer browser.',
  },
  'GET /public/shop/:organizationSlug/collection-locations': {
    notExposed:
      'The pickup-location chooser belongs to a shopper’s checkout flow. It is deliberately public and does not carry the staff context Claire uses to answer location questions.',
  },
  'GET /public/shop/:organizationSlug/:productId': {
    notExposed:
      'The public product-card projection for a shopper, including only sellable catalogue fields. Claire has the authenticated product catalogue and should not use a thinner anonymous representation.',
  },
  'GET /public/shop/:organizationSlug/orders/:accessToken': {
    notExposed:
      'Reads one guest order through the opaque token emailed to that shopper. Giving an assistant such a token would make it a customer principal; staff read orders through the authenticated dashboard.',
  },
  'POST /public/shop/:organizationSlug/checkout': {
    notExposed:
      'Creates a customer-owned Stripe Checkout session and reserves stock for that shopper’s basket. An assistant must not initiate a payment session or impersonate an anonymous purchaser.',
  },
  'POST /public/shop/:organizationSlug/:productId/notify-me': {
    notExposed:
      'Records a shopper’s own restock email request. Claire submitting it would subscribe a person without their action or consent.',
  },

  // ---- unauthenticated reads ---------------------------------------------
  'GET /public/booking/:organizationSlug': {
    notExposed:
      'The booking widget’s bootstrap payload — services, locations and policy text flattened for a public page. context_listServices gives Claire the same catalogue with the structured price model intact, which is what she needs to quote correctly.',
  },
  'GET /public/booking/:organizationSlug/locations': {
    notExposed:
      'The branch chooser a customer sees before picking where to book — name, address, hours and a photo per branch. Claire already holds the org’s locations on her organization context, in the fuller internal shape, so this is a second, thinner route to a fact she has.',
  },
  'GET /public/booking/:organizationSlug/slots': {
    notExposed:
      'Availability as a customer sees it, filtered to online-bookable services only. appointments_findOpenSlots answers the same question against the internal rules, including slots staff can fill but the public cannot.',
  },
  'GET /public/venue/:organizationSlug': {
    notExposed:
      'The public venue page content — address, hours, gallery, description. It is marketing copy about the org Claire already works inside, reachable through context_getOrganizationContext.',
  },
  'GET /public/venue/:organizationSlug/:locationSlug': {
    notExposed:
      'Per-location variant of the same public page. The locations themselves already arrive on the organization context, so this is a second route to a fact she holds.',
  },
  'GET /public/booking/:organizationSlug/manage/:token': {
    notExposed:
      'Resolves a signed manage-booking token to one customer’s appointment. That token is mailed to a single person and is the only authorisation in the flow — Claire cannot hold one, and the appointment is readable to her by org scope anyway.',
  },
  'GET /public/intake/:organizationSlug/:token': {
    notExposed:
      'Returns a customer’s intake submission against their personal token. Intake forms carry health and consent answers, which is the most sensitive PII in the product and not something to pull into a model’s context.',
  },

  // ---- microsites (docs/plans/microsites.md §9) ---------------------------
  'GET /public/microsites/resolve': {
    notExposed:
      'Maps a hostname to a microsite id. It is routing plumbing for the renderer — identifiers only, no document, no theme — and answers nothing a person would ask Claire.',
  },
  'GET /public/microsites/document': {
    notExposed:
      'The same published projection as the route below, keyed on the hostname instead of the id — it exists so the renderer makes one round trip rather than two. Claire edits a microsite through the agent tools that mutate the draft; reading the public projection would show her a stale snapshot of the site she is editing.',
  },
  'GET /public/microsites/:micrositeId/document': {
    notExposed:
      'The PUBLISHED website document plus the live business data behind it, as the anonymous renderer sees it. Claire edits a microsite through the agent tools that mutate the draft and write a revision; reading the public projection would show her a stale snapshot of the site she is editing.',
  },

  // ---- customer actions --------------------------------------------------
  'POST /public/booking/:organizationSlug/submit': {
    notExposed:
      'Submits a booking as an anonymous member of the public. A booking Claire made here would be attributed to nobody and would bypass the staff path that exists precisely so manual bookings are traceable.',
  },
  'POST /public/booking/:organizationSlug/manage/:token/cancel': {
    notExposed:
      'Cancels an appointment on the customer’s behalf using their mailed token, which also triggers the customer-facing cancellation mail. Claire cancels through the authenticated appointments tool, where the act is attributed to the business.',
  },
  'POST /public/booking/:organizationSlug/manage/:token/reschedule': {
    notExposed:
      'Moves an appointment as the customer, with the customer’s notification copy. The same reasoning as the cancel: the authenticated path already exists and records who actually made the change.',
  },
  'POST /public/intake/:organizationSlug/:token/submit': {
    notExposed:
      'Records a customer’s answers to a health and consent questionnaire. Those answers are a legal record of what the customer themselves declared; an agent filling them in would forge consent.',
  },

  // ---- patient-portal credentials (ENG-647) -------------------------------
  // These are the pre-session endpoints of the SECOND principal type — the
  // clinic's customer signing into their own portal. See tools/patient/
  // coverage.ts for the authenticated side and the full reasoning.
  'POST /public/patient-auth/request-otp': {
    notExposed:
      'Emails a one-time sign-in code to a patient. It deliberately issues no session and reveals nothing about whether an account exists — the email is the proof of ownership. Triggering sign-in mail for a customer is not the business assistant’s act.',
  },
  'POST /public/patient-auth/verify-otp': {
    notExposed:
      'Exchanges a patient’s emailed code for their session. Claire holding a patient session would let her read and act as a named individual, which is the exact boundary the portal draws.',
  },
  'POST /public/patient-auth/verify-magic-link': {
    notExposed:
      'Consumes a one-time link token to open a patient’s session. The token is handed to a single person and is the only authorisation in the flow — the same reasoning as the manage-booking token above.',
  },
});
