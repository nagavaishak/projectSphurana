import { defineCoverage } from '../coverage.types.js';

/**
 * TERMINAL — 1 endpoint, 0 tools. Stripe Terminal, the physical card reader on
 * the counter.
 *
 * The one route mints a short-lived connection token that the Stripe Terminal
 * SDK exchanges to pair with a reader over the local network. It is a
 * credential handed to a piece of hardware, and it is only usable by a client
 * that is physically near the device. Nothing about it is information, and
 * nothing about it is reachable from a conversation.
 */
export const terminalCoverage = defineCoverage('terminal', {
  'POST /terminal/connection-token': {
    notExposed:
      'Issues a short-lived Stripe Terminal connection token for the POS client to pair with a card reader on the local network. It is a credential for hardware standing in the room, not an answer to any question.',
  },
});
