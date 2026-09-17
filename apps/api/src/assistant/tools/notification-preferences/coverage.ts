import { defineCoverage } from '../coverage.types.js';

/**
 * NOTIFICATION-PREFERENCES — 2 endpoints, 0 tools. One user-scoped settings
 * blob: which channels (email, SMS, push) the signed-in user wants which alerts
 * on.
 *
 * The read is cheap and answers a real question ("am I even getting emailed
 * about new bookings?"), and it is the kind of thing an owner asks mid-conversation
 * when something did not reach them. No tool exists, so `undecided`.
 *
 * The write is the interesting one, and it is a `PUT` over the whole preference
 * set rather than a patch of one flag. These are consent-shaped choices about
 * how a person may be contacted; flipping a channel off on their behalf can
 * suppress the booking and payment alerts they expect to receive, and the person
 * whose preferences changed is not told. That belongs in the settings screen
 * where the toggles are visible.
 */
export const notificationPreferencesCoverage = defineCoverage(
  'notification-preferences',
  {
    'GET /notification-preferences': {
      undecided: 'ENG-CLAIRE-NOTIFICATION-PREFERENCES',
    },
    'PUT /notification-preferences': {
      notExposed:
        "A whole-object PUT over consent-shaped contact preferences. Turning a channel off on the user's behalf silently suppresses booking and payment alerts they expect, with no notice that anything changed — the settings screen shows the toggles and is the right surface.",
    },
  }
);
