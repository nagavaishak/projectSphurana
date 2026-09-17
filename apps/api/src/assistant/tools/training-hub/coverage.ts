import { defineCoverage } from '../coverage.types.js';

/**
 * TRAINING-HUB — 5 endpoints, 0 tools. The in-app onboarding video library plus
 * per-user watch tracking. Note the scope: these routes key on the USER, not
 * the organization — this is one person's progress through the course.
 *
 * The catalogue reads are the interesting half. "Which video shows me how to do
 * this?" is a support answer Claire is well placed to give, and the list already
 * carries the caller's completion state, so it is both useful and self-
 * contained. No tool exists, hence `undecided`.
 *
 * Everything else is watch telemetry. Progress is written by the player on a
 * timer to resume playback, and completion asserts that a specific human
 * watched a specific video — a claim Claire cannot make on their behalf, and one
 * that, if faked, hides the exact onboarding gap the hub exists to close.
 */
export const trainingHubCoverage = defineCoverage('training-hub', {
  'GET /training-hub/videos': { undecided: 'ENG-CLAIRE-TRAINING-HUB' },
  'GET /training-hub/videos/:id': { undecided: 'ENG-CLAIRE-TRAINING-HUB' },

  'GET /training-hub/progress': {
    notExposed:
      'Per-user watch positions in seconds — playback state for resuming the player, not something Claire can act on. The completion flags she would actually want when recommending a next video already ride along on the video list.',
  },
  'POST /training-hub/videos/:id/progress': {
    notExposed:
      'Playback telemetry the video player POSTs on a timer as the user watches. Claire is not watching anything, so any value she writes is fabricated resume state.',
  },
  'POST /training-hub/videos/:id/complete': {
    notExposed:
      'Asserts that this specific person finished this specific training video. Claire cannot watch it for them, and a false completion quietly hides the onboarding gap the hub exists to surface.',
  },
});
