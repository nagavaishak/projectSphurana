import { defineCoverage } from '../coverage.types.js';

/**
 * CONSENT-FORM-TEMPLATES — 7 endpoints, 0 tools. The STAFF side of treatment
 * consent (ENG-647): the forms a clinic requires a patient to sign before a
 * treatment, which services require which forms, and who has signed what.
 *
 * Unlike `patient`, this area IS in Claire's world — org-scoped, staff-session,
 * the same shape as every other settings surface she works in. It is withheld
 * on a different ground: what these routes author is a LEGAL INSTRUMENT.
 *
 * The template body is the text a patient is asked to attest to. It is written
 * once, deliberately, usually with a clinician or an insurer's wording in hand,
 * and it is frozen into a snapshot on every submission precisely so that what
 * someone signed can never drift afterwards. A model editing that text — even
 * helpfully, even correctly — changes what future patients are legally agreeing
 * to. The same goes for the service→form requirement: dropping a template from
 * a treatment silently stops collecting consent for it, which is invisible in
 * the UI until it matters.
 *
 * The reads are withheld for a narrower reason. Submissions carry health
 * declarations and signature metadata; the clinic reaches them through the
 * unified client profile, which is the surface built for that question. Giving
 * Claire a second route to the same PII buys nothing and widens the blast
 * radius of a prompt-injection.
 *
 * If a tool is ever wanted here, the safe shape is a READ of template titles
 * and per-appointment completion STATUS — never bodies, never answers, and
 * never a write.
 */
export const consentFormTemplatesCoverage = defineCoverage(
  'consent-form-templates',
  {
    // ---- templates --------------------------------------------------------
    'GET /consent-form-templates': {
      notExposed:
        'Lists the org’s consent templates including their full body text. Claire has no question she can answer better for holding the legal wording of a consent form, and the titles she might legitimately want come with the whole instrument attached.',
    },
    'POST /consent-form-templates': {
      notExposed:
        'Authors a new consent instrument. The body is what a patient will be asked to attest to; it is drafted deliberately, often from clinical or insurer wording, and is not a thing to generate.',
    },
    'POST /consent-form-templates/generate': {
      notExposed:
        'Staff-only "Write with AI" that drafts consent wording from a short description for a clinician to review and save. It authors the text a patient will be asked to attest to — the same legal-instrument reasoning as authoring one directly — so it is a human-in-the-loop settings action, not a Claire capability.',
    },
    'PUT /consent-form-templates/:id': {
      notExposed:
        'Edits the text of a consent form. Submissions freeze a snapshot precisely so signed consent cannot drift — but an edit still changes what every FUTURE patient agrees to, silently.',
    },
    'DELETE /consent-form-templates/:id': {
      notExposed:
        'Removes a consent template (soft-deactivates it when submissions reference it). Deleting one stops collecting a consent the clinic decided it needed, and nothing in the booking flow announces the gap.',
    },

    // ---- which services require which forms -------------------------------
    'GET /consent-form-templates/organization-services-form-requirements/:serviceId':
      {
        notExposed:
          'Reads which consent forms a treatment requires. It is configuration about the legal instruments above, and useful only in service of editing them.',
      },
    'PUT /consent-form-templates/organization-services-form-requirements/:serviceId':
      {
        notExposed:
          'Sets which consent forms a treatment requires. Removing one here silently stops collecting that consent on every future booking of that service — a compliance change wearing the clothes of a settings tweak.',
      },

    // ---- who has signed what ----------------------------------------------
    'GET /consent-form-templates/submissions': {
      notExposed:
        'Returns patients’ submitted consent forms — health declarations plus signature name, timestamp and IP. The client profile already answers "has this person signed?" for staff; a second path to the same PII only widens exposure.',
    },
    'GET /consent-form-templates/submissions/:id/pdf': {
      notExposed:
        'Presigns the archived PDF of one signed consent — the legal instrument itself, answers and drawn signature included. Same PII reasoning as the submissions list: staff reach it through the client profile; a model has no business pulling a signed health record into context.',
    },
  }
);
