/**
 * Tell a Meta Messenger / Instagram / WhatsApp *auto-responder* echo apart from
 * a genuine human-agent reply.
 *
 * Meta sends a `message_echoes` webhook for every message a page sends — via
 * our Send API, from the Page inbox (a human), OR the page's own automated
 * responses (Messenger Instant Reply / away messages, WhatsApp greeting &
 * away messages, Instagram auto-replies). The echo carries no `app_id` or
 * metadata, so the origin must be inferred from behaviour.
 *
 * Why this matters: a foreign echo (one that doesn't match a message WE sent)
 * normally triggers an "agent takeover" — the conversation flips to
 * agent_handling and the bot is cancelled. That is correct for a real human,
 * but wrong for an auto-responder: nobody is actually there, so the lead gets a
 * single canned auto-reply and then silence. When we recognise an
 * auto-responder we keep the bot in charge instead.
 *
 * ## How we detect it: latency
 *
 * Validated against ~39k real agent echoes (38,872 rows, 5,949 labelled by
 * cross-conversation text repetition). The signal is overwhelmingly clean and
 * bimodal: canned auto-responders reply to the lead's inbound within ~2–5s,
 * while genuine human replies — even repeated/broadcast ones — land hundreds to
 * millions of seconds later. There is essentially no overlap.
 *
 * Latency alone scores ~0.99 precision / ~0.87 recall against the labels. Two
 * earlier candidate signals were measured and dropped:
 *  - A "first page reply" gate LOST ~64% of real auto-responders: when our bot
 *    replies first (or away-messages recur), the auto-responder is no longer
 *    the page's first outbound. The gate fought the exact case we care about.
 *  - A canned-phrasing regex HURT precision (flagged slow human broadcasts:
 *    promos, hiring blasts) while adding little recall over latency.
 *
 * A short real-text requirement removes the only residual false positives —
 * fast human acks ("ok", "thanks", an emoji) that happen to land within the
 * window — lifting precision to ~0.99.
 *
 * Error cost is asymmetric and a false positive self-corrects: if we ever call
 * a fast human an auto-responder, their next reply won't be both instant and
 * substantive, so it triggers a normal takeover.
 */

/**
 * Max gap between the lead's inbound message and the page's reply for the reply
 * to count as "instant". Auto-responders fire in a few seconds; humans almost
 * never reply this fast. The bimodal split is wide enough that 10s sits in the
 * empty middle (human replies cluster well past 60s).
 */
export const AUTO_RESPONDER_MAX_LATENCY_MS = 10_000;

/**
 * Minimum number of letters/digits the echo must contain to be eligible. Drops
 * fast human acknowledgements ("ok", "thanks", "x", emoji-only) that would
 * otherwise trip the latency check; real auto-replies are full sentences.
 */
export const AUTO_RESPONDER_MIN_WORD_CHARS = 15;

/** Count letters/digits in `text` (ignores whitespace, punctuation, emoji). */
export function countWordChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length;
}

export interface EchoOriginSignals {
  /**
   * Milliseconds between the lead's most recent inbound message and this echo.
   * Null when there is no prior inbound to measure against (e.g. the page
   * initiated the conversation), which never counts as an auto-responder.
   */
  msSinceLastInbound: number | null;
  /** The echo's text body. */
  text: string;
}

export interface EchoOriginVerdict {
  isAutoResponder: boolean;
  signals: {
    /** Reply landed within {@link AUTO_RESPONDER_MAX_LATENCY_MS} of the lead. */
    instant: boolean;
    /** Body carries enough real text to be a canned message, not a fast ack. */
    hasText: boolean;
  };
  /** Echoed back for logging/observability. */
  msSinceLastInbound: number | null;
}

/**
 * Classify whether a foreign page echo is an auto-responder. True only when the
 * reply was both near-instant (reacting to a real lead inbound) and carries
 * substantive text.
 */
export function classifyEchoOrigin(
  input: EchoOriginSignals
): EchoOriginVerdict {
  const instant =
    input.msSinceLastInbound !== null &&
    input.msSinceLastInbound >= 0 &&
    input.msSinceLastInbound <= AUTO_RESPONDER_MAX_LATENCY_MS;
  const hasText = countWordChars(input.text) >= AUTO_RESPONDER_MIN_WORD_CHARS;

  return {
    isAutoResponder: instant && hasText,
    signals: { instant, hasText },
    msSinceLastInbound: input.msSinceLastInbound,
  };
}
