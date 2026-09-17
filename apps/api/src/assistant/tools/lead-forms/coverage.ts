import { defineCoverage } from '../coverage.types.js';

/**
 * LEAD-FORMS — 6 endpoints, 4 tools. Meta instant-form definitions: the
 * questions a prospect answers inside Facebook or Instagram, and the follow-up
 * channel their answers get routed to. The front door of the lead-form-first
 * campaign shape, so Claire needs to build and edit these fluently.
 *
 * The unusual thing about this area is that the local row is only half the
 * object — writes are mirrored to Meta, and the tools go through
 * `ports.leadForms`, which re-reads the row after every write specifically to
 * find out whether the Meta sync actually confirmed. That is also why
 * `GET /lead-forms/:id` is genuinely exposed rather than incidental:
 * `lead_forms_previewLeadForm` reads an existing form by id to render the
 * preview card the owner eyeballs before anything is launched.
 *
 * Create and update run UNCONFIRMED. A form on its own reaches nobody — it only
 * starts collecting when an ad is pointed at it, and that launch is confirmed
 * over in `meta-ads`. The adapter does surface the previous `metaFormId` on an
 * update, because a re-sync repointing a LIVE campaign at a form the owner has
 * not re-approved is the one edit that is not free.
 */
export const leadFormsCoverage = defineCoverage('lead-forms', {
  // ---- reads -------------------------------------------------------------
  'GET /lead-forms': { exposed: 'lead_forms_listLeadForms' },
  'GET /lead-forms/:id': { exposed: 'lead_forms_previewLeadForm' },

  // ---- writes ------------------------------------------------------------
  'POST /lead-forms': { exposed: 'lead_forms_createLeadForm', confirm: false },
  'PUT /lead-forms/:id': {
    exposed: 'lead_forms_updateLeadForm',
    confirm: false,
  },

  'POST /lead-forms/:id/sync': {
    notExposed:
      'Re-pushes an existing form to Meta. The create and update paths already sync as part of the write and report back whether Meta confirmed, so a standalone re-sync is a repair action for a form stuck out of sync — a state Claire cannot diagnose and would only retry blindly against the same rate limit.',
  },
  'DELETE /lead-forms/:id': {
    notExposed:
      'Deleting a form breaks every live ad still pointing at it, and takes with it the field definitions needed to interpret leads already captured through it. Public, irreversible damage from a single call.',
  },
});
