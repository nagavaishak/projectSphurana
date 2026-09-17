import { defineCoverage } from '../coverage.types.js';

/**
 * INTAKE-FORMS — 11 endpoints, 0 tools. Consent and medical-history forms: the
 * clinic authors a template, links it to services, and issues it to a patient
 * ahead of an appointment.
 *
 * IMPORTANT — this controller is NOT the public surface. Its own header says
 * so: every route here is `@UseGuards(AuthGuard)` and org-scoped, and the
 * patient-facing fill-in surface lives in a separate PublicIntakeController.
 * So the usual "the caller is an end customer holding a token, not the owner"
 * withholding does not apply to anything below — these are all the OWNER's
 * routes, which is exactly who Claire acts as.
 *
 * The decision therefore turns on two other things:
 *
 *   1. WHAT THE PAYLOAD CONTAINS. A form TEMPLATE is a list of questions —
 *      business configuration. A SUBMISSION is a patient's answers: medical
 *      history, allergies, a signature. Those are not the same object and do
 *      not get the same answer, even though they sit in the same area.
 *   2. NO TOOLS EXIST YET. Nothing in the registry starts `intake_`, so no
 *      entry here can be `exposed` today. The reads that Claire plausibly needs
 *      — "which forms do I have?", "is this client's paperwork outstanding for
 *      tomorrow?" — are parked as undecided rather than refused, because the
 *      capability gap is real and closing it is the cheap half.
 *
 * The writes are a different matter. A consent form is a legal record; its
 * wording is the thing being consented TO, and editing or deleting it changes
 * what a past signature is evidence of.
 */
export const intakeFormsCoverage = defineCoverage('intake-forms', {
  // ---- reads: templates and status (Claire plausibly needs these) ---------
  'GET /intake-forms': { undecided: 'ENG-CLAIRE-INTAKE-FORMS' },
  'GET /intake-forms/outstanding/:appointmentId': {
    undecided: 'ENG-CLAIRE-INTAKE-FORMS',
  },
  'GET /intake-forms/services/:serviceId/forms': {
    undecided: 'ENG-CLAIRE-INTAKE-FORMS',
  },

  'GET /intake-forms/:id': {
    notExposed:
      'Returns one template in full, including every question definition. listIntakeForms already returns whole rows, so the list is the way in — and a model that is handed a bare form id it did not just read has no way to know it belongs to this org.',
  },

  // ---- reads: patient answers --------------------------------------------
  'GET /intake-forms/submissions/lead/:leadId': {
    notExposed:
      'Returns every submission row for a client, answers included — medical history, allergies, consent signatures. That is special-category health data about a third party; it belongs on the clinician-facing client profile behind a deliberate click, not in an assistant transcript that gets summarised, logged and sent to a model.',
  },

  // ---- writes -------------------------------------------------------------
  'POST /intake-forms': {
    notExposed:
      'Authoring a consent or medical-history form is a clinical and legal drafting act — the wording is the thing the patient is consenting to. A model-generated question set could omit a required disclosure and nobody would notice until it mattered.',
  },
  'PUT /intake-forms/:id': {
    notExposed:
      "Editing a live template changes what future patients agree to. Submissions snapshot the questions at send time precisely so the record stays stable, which makes an edit here a quiet change to the clinic's standing consent wording.",
  },
  'DELETE /intake-forms/:id': {
    notExposed:
      'Removes a form the clinic may be relying on for a booked service, and it is the anchor for every submission already issued against it. Destroying compliance paperwork is a deliberate human action.',
  },
  'POST /intake-forms/seed-templates': {
    notExposed:
      'Bulk-creates forms from the pre-built template library into the org. It is a one-off setup action taken from the settings screen, and a stray call would drop a pile of unreviewed clinical forms into a live clinic.',
  },
  'POST /intake-forms/issue': {
    notExposed:
      "Mints a pending submission and returns the RAW patient token in the response body — the caller is expected to embed it in a send link and drop it. This endpoint sends nothing itself, so Claire could not complete the job, and surfacing a bearer token that opens a patient's medical form into a model transcript is not a thing to do.",
  },
  'PUT /intake-forms/services/:serviceId/forms': {
    notExposed:
      'Sets which forms gate a service at booking time. Getting it wrong silently blocks bookings (extra form) or lets a treatment proceed without consent (missing form) — a compliance switch that wants a human deciding it.',
  },
});
