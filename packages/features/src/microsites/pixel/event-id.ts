/**
 * Moved to `@borradh-workspace/web-shared` so the browser pixel and the CAPI
 * sender compute the SAME id from one definition — see the note there. They
 * previously disagreed twice over: the browser minted a random UUID, and its
 * validator rejected the `:` the derived form uses.
 *
 * Re-exported here so existing imports are unchanged.
 */
export {
  buildMicrositeEventId,
  isValidMicrositeEventId,
  MICROSITE_EVENT_ID_PATTERN,
  type MicrositeEventIdParts,
} from '@borradh-workspace/web-shared';
