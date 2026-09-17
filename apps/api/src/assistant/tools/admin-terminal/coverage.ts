import { defineCoverage } from '../coverage.types.js';

/**
 * ADMIN-TERMINAL — 17 endpoints, 0 tools. The internal staff console, and the
 * one area on the surface that is CROSS-TENANT BY DESIGN.
 *
 * Every other area answers "what is true for this organization". These answer
 * "what is true across all of them", which inverts the single invariant every
 * Claire tool relies on. She runs on behalf of one business; a tool here would
 * let a prompt in one customer's inbound message read or act against another
 * customer's data. That is not a policy preference — it is the boundary.
 *
 * The area is also gated behind staff identity plus a fresh 2FA challenge, and
 * everything it does is written to an audit log attributed to a named human.
 * An agent acting through it would produce audit rows attributed to whoever
 * happened to be signed in, which destroys the only record that makes staff
 * access to customer data defensible.
 *
 * Note the shape of the split below: even the READS stay closed here, which is
 * the opposite of this gate's usual default. The verb asymmetry assumes a
 * single-tenant scope; without it, a read is the dangerous half.
 */
export const adminTerminalCoverage = defineCoverage('admin-terminal', {
  // ---- cross-tenant reads ------------------------------------------------
  'GET /admin-terminal/organizations': {
    notExposed:
      'Lists every organization on the platform. Claire’s entire safety model rests on being scoped to one org; an endpoint that enumerates all of them removes the boundary rather than testing it.',
  },
  'GET /admin-terminal/organizations/:id': {
    notExposed:
      'Full internal profile of an arbitrary org — plan, connections, usage, contact details. Reachable for any id, so it is a cross-tenant read by construction.',
  },
  'GET /admin-terminal/organizations/:id/conversation-stats': {
    notExposed:
      'Conversation volumes and bot-handling rates for another business. Competitively sensitive on its own, and the org boundary is the only thing keeping it private.',
  },
  'GET /admin-terminal/audit-logs': {
    notExposed:
      'The record of which staff member accessed which customer’s data. Letting an agent read the audit trail undermines the trail; letting it read one it may also be writing to is worse.',
  },

  'GET /admin-terminal/stripe/self-serve-link': {
    notExposed:
      'Returns the onboarding link an operator sends a prospect. Harmless to read, but it belongs to the sales conversation it is sent in — a link produced by an agent, in a message the operator did not write, is a phishing shape whether or not the URL is genuine.',
  },

  // ---- Meta asset linking ------------------------------------------------

  'GET /admin-terminal/meta/self-serve-link': {
    notExposed:
      'Returns the onboarding link an operator sends a prospect. Harmless to read, but it belongs to the sales conversation it is sent in — a link produced by an agent, in a message the operator did not write, is a phishing shape whether or not the URL is genuine.',
  },
  'GET /admin-terminal/meta/pending': {
    notExposed:
      'Lists every business that has authorised us but not yet been attached to a workspace, with the Page and the person who authorised. Cross-tenant by construction, and a live view of who is mid-onboarding.',
  },
  'POST /admin-terminal/meta/pending/:pendingId/claim': {
    notExposed:
      'Decides whose Facebook presence a workspace publishes and advertises as. The pairing exists only in the operator\u2019s head after a sales call; a wrong one points one salon\u2019s Page at another salon\u2019s workspace, and the mistake is invisible until a customer notices.',
  },

  'GET /admin-terminal/organizations/:id/onboarding': {
    notExposed:
      'Reads another business\u2019s subscription and payout account ids. Cross-tenant by construction — reachable for any org id — and the ids themselves are the handles to that business\u2019s money.',
  },
  'POST /admin-terminal/organizations/:id/stripe/link': {
    notExposed:
      'Binds a Stripe connected account to an organization — the destination every future payout lands in. The acct_ id is read off the Stripe dashboard by the person who onboarded that merchant, and a wrong one sends one salon\u2019s takings to another salon\u2019s bank account.',
  },
  'POST /admin-terminal/organizations/:id/subscription/seed': {
    notExposed:
      'Marks an organization as paying, off a Stripe id an operator read during a sales call. It grants plan access and an opening credit balance without a payment ever passing through the product, so the only thing standing between it and free service is a named human who was on that call.',
  },

  // ---- impersonation -----------------------------------------------------
  'POST /admin-terminal/verify-2fa': {
    notExposed:
      'The fresh second-factor challenge that unlocks the console for a named human. Its whole purpose is to prove a person is present, which an agent cannot do and must not stand in for.',
  },
  'POST /admin-terminal/impersonate': {
    notExposed:
      'Issues a session acting as another user in another organization. This is the largest privilege escalation in the product, and it is only defensible because a specific human is on record as having used it.',
  },
  'POST /admin-terminal/stop-impersonating': {
    notExposed:
      'Ends an impersonated session. Only meaningful to a staff member who started one, and the escalation half is already closed.',
  },

  // ---- fleet-wide backfills ----------------------------------------------
  'POST /admin-terminal/backfill-asset-analysis': {
    notExposed:
      'Queues AI analysis across every org’s media library. It spends real model budget at fleet scale and there is no per-customer intent that justifies running it.',
  },
  'POST /admin-terminal/backfill-asset-probes': {
    notExposed:
      'Re-probes stored media for duration and codec across all orgs. A bulk repair job run deliberately after a pipeline change, not a thing to trigger conversationally.',
  },
  'POST /admin-terminal/backfill-asset-thumbnails': {
    notExposed:
      'Regenerates thumbnails fleet-wide. Heavy worker load with no owner-visible outcome, and it competes with the render queue customers are actually waiting on.',
  },
  'POST /admin-terminal/backfill-asset-transcodes': {
    notExposed:
      'Re-transcodes source media across every organization — the most expensive job on the platform, and one that has previously saturated the worker pool on its own.',
  },
});
