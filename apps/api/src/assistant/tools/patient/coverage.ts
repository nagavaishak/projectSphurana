import { defineCoverage } from '../coverage.types.js';

/**
 * PATIENT — 12 endpoints, 0 tools. The signed-in PATIENT PORTAL (ENG-647): the
 * clinic's own customer, logged into their own account, looking at their own
 * bookings, consent forms and clinical documents.
 *
 * One fact decides the entire area, and it is the same one that decides
 * `public`: WHO the route speaks for. Claire acts for the BUSINESS, inside a
 * staff session. Every route here acts for ONE PATIENT and is authorised by a
 * `patient_session` — a second principal type with its own Postgres role
 * (`app_patient`) whose RLS policies scope every read to that single person's
 * rows. Claire cannot hold such a session. If she could, holding one would mean
 * she could read and act as a named patient, which is precisely the boundary
 * the portal exists to draw.
 *
 * The reads are not withheld for secrecy — the clinic can already see all of it
 * from the authenticated side, in richer form: the unified client profile
 * (`GET /leads/:id/profile`) returns this patient's bookings, form submissions,
 * documents and notes in one payload, scoped by org the way the rest of Claire's
 * world is. Pointing her at the patient projection instead would be a thinner
 * answer by a longer route, through a session she has no legitimate way to hold.
 *
 * The writes are the patient's OWN acts. A consent signature is a legal record
 * of what a named human personally attested to, captured with their typed name,
 * a timestamp and their IP; an agent submitting one would forge consent. A
 * cancellation made "as the patient" would be attributed to nobody and would
 * skip the staff path that exists so such changes are traceable.
 */
export const patientCoverage = defineCoverage('patient', {
  // ---- session ------------------------------------------------------------
  'GET /patient/me': {
    notExposed:
      'Resolves the patient session to that one person’s identity. It answers "who am I" for a principal Claire is not and cannot become; the same person is reachable to her as a lead, by org scope.',
  },
  'POST /patient/logout': {
    notExposed:
      'Revokes a patient’s own session. There is no session of this kind in Claire’s world to revoke, and ending a customer’s login is not an act the business assistant should perform.',
  },

  // ---- the patient's own bookings ----------------------------------------
  'GET /patient/bookings': {
    notExposed:
      'One patient’s appointment list as they see it. appointments_* answers the same question against the org calendar with the internal rules applied, which is the fuller picture and the one attributed correctly.',
  },
  'POST /patient/bookings/:id/cancel': {
    notExposed:
      'Cancels an appointment AS THE PATIENT, sending the customer-facing cancellation mail and rotating their manage-link token. Claire cancels through the authenticated appointments tool, where the act is recorded as the business making it.',
  },
  'POST /patient/bookings/:id/reschedule': {
    notExposed:
      'Moves an appointment as the patient, with the customer’s notification copy. Same reasoning as the cancel — the staff path already exists and records who actually made the change.',
  },

  // ---- consent forms the patient must sign -------------------------------
  'GET /patient/consent-forms': {
    notExposed:
      'This patient’s outstanding and completed consent forms. Staff read the same submissions org-scoped via the consent-form-templates submissions route and the client profile.',
  },
  'GET /patient/consent-forms/:id': {
    notExposed:
      'A single submission including the frozen template snapshot and the patient’s answers — health declarations and consent, the most sensitive PII in the product, and not something to pull into a model’s context.',
  },
  'POST /patient/consent-forms/:id/sign': {
    notExposed:
      'Records a legal signature: typed name, timestamp and IP, attesting that a named human read and agreed to a treatment consent. An agent signing this would forge consent — there is no version of this that is ever safe to expose.',
  },

  // ---- the patient's document vault --------------------------------------
  'GET /patient/documents': {
    notExposed:
      'One patient’s clinical document list. Staff see the same rows on the client profile, org-scoped, which is the right lens for the business assistant.',
  },
  'POST /patient/documents/presign': {
    notExposed:
      'Mints a presigned S3 PUT under this patient’s own key prefix. Claire has no file to upload on a patient’s behalf, and minting write credentials into a patient’s clinical folder is not an assistant’s act.',
  },
  'POST /patient/documents': {
    notExposed:
      'Records an uploaded document as PATIENT-supplied. The uploader type is part of the clinical record’s provenance; an agent writing rows here would misattribute where a file came from.',
  },
  'GET /patient/documents/:id/download': {
    notExposed:
      'Mints a short-lived presigned GET for one patient’s clinical file. The file contents are exactly the sensitive material the vault exists to hold, and the staff download route already serves the business side.',
  },
  'GET /patient/consent-forms/:id/pdf': {
    notExposed:
      'Mints a presigned GET for the patient’s own signed-consent PDF, inside their portal session. Claire cannot hold a patient session, and the document is a signed health record — the same vault reasoning as the document download above.',
  },
});
