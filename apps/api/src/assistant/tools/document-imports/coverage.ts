import { defineCoverage } from '../coverage.types.js';

/**
 * DOCUMENT IMPORTS (ENG-784) — 7 endpoints, 0 tools.
 *
 * The bulk "Import Documents" flow: stage a PDF/photo, have the matcher file
 * it against a client, and let staff resolve what it could not. Every route
 * here either mints write access into a client's clinical folder, records a
 * clinical document under a named staff uploader, or exposes what the model
 * read off one. The staff vault routes in tools/leads/coverage.ts draw the
 * same line for the same reasons; this is the bulk entrance to that vault.
 */
export const documentImportsCoverage = defineCoverage('document-imports', {
  // ---- reads -------------------------------------------------------------
  'GET /document-imports': {
    notExposed:
      'Lists staged clinical files with what the model read off each one — names, contact details, dates of birth. That is review-queue material for a person at the front desk, not context for an assistant, and the answer to "has it been filed?" is already on the client profile.',
  },
  'GET /document-imports/:id': {
    notExposed:
      'One staged file’s extracted identity fields and candidate clients. Same exposure as the list, narrowed to one record; there is no assistant question it answers that the profile does not.',
  },

  // ---- writes ------------------------------------------------------------
  'POST /document-imports/presign': {
    notExposed:
      'Mints presigned write credentials into the org’s clinical staging area. Claire has no file to upload, and issuing write access to clinical storage is not an assistant’s act.',
  },
  'POST /document-imports/:id/complete': {
    notExposed:
      'Confirms a browser upload landed and queues the matcher. Only meaningful after a presign the assistant cannot perform.',
  },
  'POST /document-imports/:id/assign': {
    notExposed:
      'Files a document into a client’s vault as a named staff member’s decision — the override for the cases the matcher itself declined. The uploader identity is provenance on a clinical record; a row Claire wrote would claim a person filed something they never saw.',
  },
  'DELETE /document-imports/:id': {
    notExposed:
      'Discards a staged clinical file. Deciding that a client’s paperwork is not worth keeping is a deliberate human act, with the same retention reasoning that keeps the vault delete out.',
  },
  'DELETE /document-imports/settled': {
    notExposed:
      'Clears the finished rows out of the review queue in one call. Tidying a work queue is the front desk’s housekeeping, and a bulk delete Claire could reach is a bulk delete she could reach by mistake — for no question it lets her answer.',
  },
});
