import { defineCoverage } from '../coverage.types.js';

/**
 * NOTIFICATIONS — 6 endpoints, 0 tools. The in-app notification feed for the
 * signed-in user, plus native push-token registration for the mobile app. All
 * six are user-scoped rather than org-scoped.
 *
 * The feed read is a genuine capability — "what happened while I was out?" is a
 * question owners open Claire to ask, and the feed is where booking, payment and
 * campaign events land. No tool exists for it, so it is `undecided`.
 *
 * The writes are all read-receipt bookkeeping, and that is exactly why they stay
 * out. Marking something read is the record that a HUMAN saw it. Claire clearing
 * an item — or worse, all of them in one call — does not surface the alert, it
 * makes the alert invisible while claiming it was handled. That is a silent
 * failure with no trace in the UI. The push-token pair is a device handshake
 * whose token only the native SDK on the handset can produce, and whose deletion
 * silences the owner's phone.
 */
export const notificationsCoverage = defineCoverage('notifications', {
  'GET /notifications': { undecided: 'ENG-CLAIRE-NOTIFICATIONS' },

  'GET /notifications/unread-count': {
    notExposed:
      'A single integer for the bell badge. The feed itself already tells Claire what is unread and what it says, so the count adds a round trip and no information she could act on.',
  },
  'POST /notifications/:id/read': {
    notExposed:
      'A read receipt is the record that a person actually saw the alert. Claire marking it read removes it from the badge without anyone having read it, which is indistinguishable from the alert never firing.',
  },
  'POST /notifications/read-all': {
    notExposed:
      'The same failure wholesale — one call clears every unseen alert at once. There is no undo and no way for the owner to discover what they never saw.',
  },
  'POST /notifications/push-token': {
    notExposed:
      'Device registration handshake. The token is minted by the native push SDK on the physical handset; Claire has no source for a real one and a fabricated token silently black-holes every future push.',
  },
  'DELETE /notifications/push-token': {
    notExposed:
      "Unregisters a device, which stops push notifications reaching the owner's phone. Silencing someone's handset is not a chat-turn decision, and nothing tells them it happened.",
  },
});
