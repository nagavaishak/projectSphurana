import { defineCoverage } from '../coverage.types.js';

/**
 * LEADS — 14 endpoints, 6 tools. The area that shows all three states, and the
 * one that proves `exposed:` is verified rather than asserted: every tool name
 * below is checked against the actual `*.tool.ts` sources, so renaming a tool
 * without updating this file fails the gate.
 *
 * That check is not hypothetical. `assignLeadsToSequence` sat in a skill's
 * `toolNames` for a month after its tool was switched off, because nothing tied
 * the claim to the implementation.
 */
export const leadsCoverage = defineCoverage('leads', {
  // ---- reads -------------------------------------------------------------
  'GET /leads': { exposed: 'leads_listLeads' },
  'GET /leads/stats': { exposed: 'leads_getLeadStats' },
  'GET /leads/stage-counts': {
    notExposed:
      'Per-stage and per-tab counts that power the Customers-list tab badges. leads_getLeadStats already gives Claire the same stage breakdown in a shape built for a model; this endpoint exists for the UI badges and would be a second path to the same numbers.',
  },
  'GET /leads/summary': { exposed: 'leads_summariseRecentLeads' },

  'GET /leads/:id': {
    notExposed:
      'No single-lead read tool exists yet. listLeads and searchLeads already return the full row, so Claire reaches a lead by listing or searching rather than by id — she is never handed an id she did not just read. Worth adding only if a flow appears that starts from a bare id.',
  },
  'GET /leads/:id/history': {
    notExposed:
      'The timeline joins sequence executions and lead activity into a long, mostly-empty narrative. It is built for the detail page to render, not for a model to summarise, and it would dominate the context window for little signal.',
  },
  'GET /leads/export': {
    notExposed:
      'Streams a CSV file download. There is nothing useful for Claire to do with a byte stream she cannot attach, and the same rows are already reachable through listLeads.',
  },

  // ---- writes ------------------------------------------------------------
  // `confirm` is mandatory on every write. Creating and editing a lead are
  // cheap and reversible, so they run unconfirmed; anything that destroys or
  // bulk-mutates does not.
  'POST /leads': { exposed: 'leads_createLead', confirm: false },
  'PUT /leads/:id': { exposed: 'leads_updateLead', confirm: false },

  'PATCH /leads/:id/status': {
    notExposed:
      'Superseded by leads_updateLead, which sets status among other fields. Two tools writing one column is how a model ends up choosing the wrong one — the create-vs-regenerate defect in the audit is exactly that shape.',
  },
  'DELETE /leads/:id': {
    notExposed:
      'Deleting a lead destroys the contact history an owner may need for consent or dispute records. Reversible only from a backup, so it stays a deliberate human action in the UI.',
  },
  'POST /leads/import': {
    notExposed:
      'Bulk import takes a pre-parsed batch payload assembled by the upload UI. Claire has no way to obtain that payload, and a partial import is painful to unwind.',
  },
  'POST /leads/import-csv': {
    notExposed:
      'Same as /leads/import — it consumes an uploaded file. Claire cannot hold a file, and a mis-mapped column set would corrupt the whole lead table.',
  },

  // ---- the unified client profile (ENG-647) -------------------------------
  'GET /leads/:id/profile': {
    notExposed:
      'The staff-side aggregate for one person: bookings, consent submissions, clinical documents and notes in a single payload. Each part is reachable through the tool that owns it, and the parts Claire is deliberately kept away from — signed consent answers, clinical files — arrive here bundled with the parts she may legitimately read. Withheld as a bundle rather than split, because the value of this route IS the bundling.',
  },

  // ---- a client's document vault, staff side ------------------------------
  // The patient-facing twins live in tools/patient/coverage.ts. These are
  // org-scoped and staff-authorised, so the boundary here is the CONTENT.
  'GET /leads/:leadId/documents': {
    notExposed:
      'Lists a client’s clinical documents — referral letters, treatment reports, ID. The list is already on the client profile for staff; giving a model a second path to it widens exposure of the most sensitive material in the product for no new answer.',
  },
  'GET /leads/:leadId/documents/:documentId/download': {
    notExposed:
      'Mints a short-lived presigned URL to a client’s clinical file. The contents are exactly what the vault exists to protect, and a URL in a model’s context is a URL that has left the guarded path.',
  },
  'POST /leads/:leadId/documents/presign': {
    notExposed:
      'Mints presigned write credentials into a client’s clinical folder. Claire has no file to upload, and issuing write access to a medical record is not an assistant’s act.',
  },
  'POST /leads/:leadId/documents': {
    notExposed:
      'Records a document as STAFF-uploaded against a client. The uploader identity is provenance on a clinical record; a row Claire wrote would claim a named staff member filed something they never saw.',
  },
  'DELETE /leads/:leadId/documents/:documentId': {
    notExposed:
      'Soft-deletes a clinical document. Removing something from a care record is a deliberate human act with retention consequences, and the same reasoning that keeps DELETE /leads/:id out applies with more force here.',
  },
});
