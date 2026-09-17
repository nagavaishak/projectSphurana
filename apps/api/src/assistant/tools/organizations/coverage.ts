import { defineCoverage } from '../coverage.types.js';

/**
 * ORGANIZATIONS — 11 endpoints, 0 tools. The org registry and its membership:
 * creating a business, listing the ones a user belongs to, and the invite →
 * accept → remove lifecycle for staff accounts.
 *
 * Almost none of this is Claire's, and for once that is not caution — it is
 * SCOPE. Claire runs inside one active organisation on behalf of its owner.
 * Most routes here are either cross-org (the user's org list, their pending
 * invitations) or account-lifecycle acts performed by a human about their own
 * access. Neither is a business capability.
 *
 * The two exceptions are worth naming. The staff roster (`/members`) is context
 * Claire demonstrably lacks — `appointments_bookAppointment` takes an optional
 * `practitionerId` with no tool that can produce one, so the person half of a
 * booking is unreachable except as an id echoed back out of an existing
 * appointment. And `/chatbot-settings` governs Claire's own auto-responder,
 * which is the thing owners most often want turned off in the moment.
 */
export const organizationsCoverage = defineCoverage('organizations', {
  // ---- reads -------------------------------------------------------------
  // The staff list. The gap behind the unusable `practitionerId` parameter —
  // see also the practitioners area, which parks the same question.
  'GET /organizations/:id/members': { undecided: 'ENG-CLAIRE-MEMBERS-READ' },
  // Logo, colours and tone — the inputs the graphics and video tools render
  // with, currently resolved server-side where Claire cannot inspect them.
  'GET /organizations/:id/brand': { undecided: 'ENG-CLAIRE-BRAND-READ' },

  'GET /organizations': {
    notExposed:
      'Lists every organisation the signed-in USER belongs to, which for an agency owner spans other people’s businesses. Claire is scoped to one active org; handing her a cross-tenant directory invites her to reason about, and eventually act on, a business she was not invoked for.',
  },
  'GET /organizations/:id': {
    notExposed:
      'The org profile row, already served to Claire in model-shaped form by `GET /assistant/context` behind `context_getOrganizationContext`. A second route answering the same question is how a model ends up quoting whichever it happened to call.',
  },
  'GET /organizations/invitations/pending': {
    notExposed:
      'Invitations addressed to the signed-in user’s own email address — an account-level inbox about their personal access to other businesses. It says nothing about running the org Claire is working in.',
  },
  'GET /organizations/invitations/token/:token': {
    notExposed:
      'A public, unauthenticated route that resolves an invite token so the sign-up page can show who invited you. It is only reachable with a secret from an email link, and it is page plumbing rather than a capability.',
  },

  // ---- writes ------------------------------------------------------------
  // The customer chatbot's config row. `chatbots_setDirective` writes exactly
  // ONE field of it — `chatbotSystemPrompt`, the top-level override injected as
  // the bot's CUSTOM DIRECTIVE — and the service applies only the fields the
  // body carries, so the structured settings and knowledge base are untouched.
  // `confirm: true`: it rewrites how the live bot talks to every customer.
  // (The bot on/off switches live behind `chatbots_setEnabled` in the
  // integrations area; this endpoint is the directive half.)
  'PUT /organizations/:id/chatbot-settings': {
    exposed: 'chatbots_setDirective',
    confirm: true,
  },

  'POST /organizations': {
    notExposed:
      'Creates an entire new tenant — a second business, with its own catalogue, calendar and billing. It belongs to the sign-up flow, and an org spun up from a misread sentence leaves the owner with a duplicate business they must be talked through deleting.',
  },
  'POST /organizations/:id/invitations': {
    notExposed:
      'Admin-only, and it sends a real email granting a named stranger access to the business’s customer records. Claire dispatching access grants off her own reasoning is a security decision the owner never explicitly made.',
  },
  'POST /organizations/invitations/:invitationId/accept': {
    notExposed:
      'An act of consent by the invited human — the payload literally carries their acceptance of the terms. Consent cannot be delegated to an assistant on that person’s behalf.',
  },
  'DELETE /organizations/:id/members/:userId': {
    notExposed:
      'Revokes a staff member’s access to the business and invalidates their session. It is a dismissal in software form: immediate, visible to that person, and not something to be inferred from a conversation the owner is having about a rota.',
  },
});
