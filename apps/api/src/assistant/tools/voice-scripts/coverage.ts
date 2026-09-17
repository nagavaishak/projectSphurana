import { defineCoverage } from '../coverage.types.js';

/**
 * VOICE-SCRIPTS — 6 endpoints, 0 tools. A reusable library of talking-head
 * scripts an org can save and reuse across videos, with one marked default.
 *
 * Clean split. The three reads are cheap, org-scoped and would let Claire say
 * "you already have a script for this" instead of generating a fifth variant of
 * it — they are `undecided` only because nobody has built the tool, not because
 * anyone decided against them.
 *
 * The three writes stay out for a specific reason rather than a general one:
 * Claire ALREADY writes scripts, via `videos_generateVideoScript`, straight into
 * the draft video she is building. Adding a second writer aimed at the shared
 * library gives her two ways to produce the same artifact with different
 * lifetimes — one scoped to a draft, one permanent and reused by every future
 * video. That ambiguity is the create-vs-regenerate defect in the audit.
 */
export const voiceScriptsCoverage = defineCoverage('voice-scripts', {
  // ---- reads -------------------------------------------------------------
  'GET /voice-scripts': { undecided: 'ENG-CLAIRE-VOICE-SCRIPTS' },
  'GET /voice-scripts/:id': { undecided: 'ENG-CLAIRE-VOICE-SCRIPTS' },
  'GET /voice-scripts/default': { undecided: 'ENG-CLAIRE-VOICE-SCRIPTS' },

  // ---- writes ------------------------------------------------------------
  'POST /voice-scripts': {
    notExposed:
      'Claire already generates scripts through videos_generateVideoScript, which writes into the draft video being built. A second writer that saves into the permanent reusable library gives her two tools for one artifact and no way to tell which the owner meant.',
  },
  'PUT /voice-scripts/:id': {
    notExposed:
      'Overwrites a saved script in place, including whichever one is flagged default — so every future video silently picks up the rewrite. Editing shared, reused content belongs in the UI where the owner can see the before and after.',
  },
  'DELETE /voice-scripts/:id': {
    notExposed:
      'Destroys a reusable script with no undo. Cheap for Claire to call, expensive for an owner who spent time on the wording, and nothing in a chat turn justifies the risk.',
  },
});
