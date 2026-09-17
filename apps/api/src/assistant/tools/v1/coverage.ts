import { defineCoverage } from '../coverage.types.js';

/**
 * V1 — 30 endpoints, 0 tools. The PUBLIC partner API: a stable, versioned,
 * API-key-authenticated mirror of surfaces Claire already reaches internally.
 *
 * This whole area is `notExposed` for one structural reason, stated once here
 * so the per-entry reasons can say what is actually particular about each
 * route: v1 is authenticated by an API KEY issued to a third-party integrator,
 * not by the owner's session. Claire runs inside that session. Pointing her at
 * v1 would mean either minting her a key (a second credential with a second
 * revocation story) or letting her act as an integrator she is not.
 *
 * The second reason matters more for behaviour: v1 is a DELIBERATELY NARROWER
 * contract than the internal one. It is frozen for external consumers, so its
 * payloads omit fields the internal endpoints return and its writes skip the
 * orchestration the internal ones perform. A tool built on v1 would be a worse
 * version of a tool that already exists — and two tools writing one row is the
 * failure mode this gate was built to catch.
 */
export const v1Coverage = defineCoverage('v1', {
  // ---- leads: mirrored by six live tools ---------------------------------
  'GET /v1/leads': {
    notExposed:
      'Frozen public mirror of GET /leads, which leads_listLeads already reads with the full internal row. The v1 projection drops fields Claire uses to qualify a lead.',
  },
  'GET /v1/leads/:id': {
    notExposed:
      'Single-lead read for integrators holding an external id. Claire reaches leads by listing or searching, so she is never handed a bare id to resolve.',
  },
  'GET /v1/leads/:id/history': {
    notExposed:
      'Public copy of the lead timeline, withheld internally for the same reason: a long, mostly-empty narrative built for a detail page to render rather than for a model to summarise.',
  },
  'GET /v1/leads/stats': {
    notExposed:
      'Duplicates GET /leads/stats, which leads_getLeadStats already reads. A second path to one number is how a model quotes two different totals in one answer.',
  },
  'POST /v1/leads': {
    notExposed:
      'Integrator-facing lead creation. leads_createLead writes through the internal endpoint, which also runs source attribution and nurture enrolment that v1 deliberately omits.',
  },
  'PUT /v1/leads/:id': {
    notExposed:
      'Frozen update contract accepting a narrower field set than leads_updateLead, which is the tool Claire already has for this exact row.',
  },
  'DELETE /v1/leads/:id': {
    notExposed:
      'Destroys the contact history an owner may need for consent or dispute records — withheld internally for that reason, and the public mirror inherits it.',
  },

  // ---- appointments ------------------------------------------------------
  'GET /v1/appointments': {
    notExposed:
      'Public mirror of the appointment list that appointments_listAppointments reads internally, with a fixed field set that omits practitioner and deposit state.',
  },
  'GET /v1/appointments/:id': {
    notExposed:
      'Single-appointment read by external id. Claire works from lists and slot searches, and the internal detail is richer.',
  },
  'POST /v1/appointments': {
    notExposed:
      'Creates a booking through the partner contract. appointments_bookAppointment goes through the internal path, which enforces availability, overlap and deposit rules this one is allowed to bypass.',
  },
  'PUT /v1/appointments/:id': {
    notExposed:
      'Partner-facing appointment update. Rescheduling through it would skip the notification and slot-revalidation that appointments_rescheduleAppointment performs.',
  },
  'DELETE /v1/appointments/:id': {
    notExposed:
      'Hard-deletes the appointment rather than cancelling it, so the customer is never notified and the slot history disappears. Cancellation is the operation Claire has.',
  },

  // ---- social posts ------------------------------------------------------
  'GET /v1/social-posts': {
    notExposed:
      'Frozen mirror of the social post list social_posts_listRecentPosts already reads, without the draft/render state Claire needs to say whether a post is publishable.',
  },
  'GET /v1/social-posts/:id': {
    notExposed:
      'Single post read for integrators. The internal detail carries the channel and media status that determine what Claire can truthfully report.',
  },
  'POST /v1/social-posts': {
    notExposed:
      'Partner post creation. social_posts_createSocialPostDraft is the tool for this, and it attaches the org’s channel selection and media handling that v1 leaves to the caller.',
  },
  'PUT /v1/social-posts/:id': {
    notExposed:
      'Frozen update contract duplicating social_posts_updateSocialPostDraft. Two writers on one draft row is exactly the create-vs-regenerate confusion the audit flagged.',
  },
  'POST /v1/social-posts/:id/publish': {
    notExposed:
      'Publishes to the connected Page through the partner contract. social_posts_publishPostNow already owns this irreversible act, including its confirmation story.',
  },
  'DELETE /v1/social-posts/:id': {
    notExposed:
      'Deletes a post record via the public API. social_posts_deleteSocialPostDraft covers the draft case Claire should touch; deleting published history is not hers.',
  },

  // ---- lead forms --------------------------------------------------------
  'GET /v1/lead-forms': {
    notExposed:
      'Public mirror of the list lead_forms_listLeadForms reads, minus the nurture wiring that tells Claire whether a form actually leads anywhere.',
  },
  'GET /v1/lead-forms/:id': {
    notExposed:
      'Single form read by external id; lead_forms_previewLeadForm renders the same form in the shape Claire can show an owner.',
  },
  'POST /v1/lead-forms': {
    notExposed:
      'Creates a form with no follow-up sequence attached. lead_forms_createLeadForm builds the form AND the nurture, and a form nobody follows up collects leads into a void.',
  },
  'PUT /v1/lead-forms/:id': {
    notExposed:
      'Frozen update contract for a row lead_forms_updateLeadForm already owns, with a narrower accepted field set.',
  },
  'DELETE /v1/lead-forms/:id': {
    notExposed:
      'Removing a live form breaks whatever ad or link points at it, and the leads already captured lose the form that explains their origin.',
  },

  // ---- assets ------------------------------------------------------------
  'GET /v1/assets': {
    notExposed:
      'Partner mirror of the media library. content_listMedia already gives Claire the assets in the shape a render actually consumes.',
  },
  'GET /v1/assets/:id': {
    notExposed:
      'Single asset metadata read. Claire selects assets from a list she just read, never by an id supplied from outside.',
  },
  'POST /v1/assets': {
    notExposed:
      'Registers an asset against storage the integrator uploaded themselves. Claire cannot hold a file or perform an upload, so she can never supply a valid object key.',
  },
  'DELETE /v1/assets/:id': {
    notExposed:
      'Deleting source media breaks every video and graphic that references it, and the original is gone. Reversible only from a storage backup.',
  },

  // ---- organization reads ------------------------------------------------
  'GET /v1/organization': {
    notExposed:
      'Public profile projection of the org. context_getOrganizationContext gives Claire the internal version, which includes the currency, timezone and connection state her answers depend on.',
  },
  'GET /v1/organization/locations': {
    notExposed:
      'Frozen locations list for integrators. The internal organization context already carries locations in the same answer, so a second call would only risk disagreeing with it.',
  },
  'GET /v1/organization/services': {
    notExposed:
      'Public services list without the structured pricing model — price type, cents and variants — that context_listServices returns and that Claire must have to quote a price correctly.',
  },
});
