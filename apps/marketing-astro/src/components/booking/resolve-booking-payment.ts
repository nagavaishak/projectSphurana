/**
 * Re-export of the ONE payment resolver (`@borradh-workspace/web-shared`).
 *
 * This file briefly held a verbatim copy. It must never hold one again: the UI
 * and the server have to agree on what the customer is charged, and a
 * paraphrase of this logic is what produced a "Pay deposit & book" button that
 * charged nothing. If you find yourself editing arithmetic here, you are in the
 * wrong file — edit web-shared and both sides move together.
 */
export * from '@borradh-workspace/web-shared';
