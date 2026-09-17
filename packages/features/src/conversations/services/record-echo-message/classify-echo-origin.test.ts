import { describe, expect, it } from '@borradh-workspace/testing';
import {
  AUTO_RESPONDER_MAX_LATENCY_MS,
  AUTO_RESPONDER_MIN_WORD_CHARS,
  classifyEchoOrigin,
  countWordChars,
} from './classify-echo-origin.js';

describe('countWordChars', () => {
  it('counts letters and digits only', () => {
    expect(countWordChars('Thanks for your message')).toBe(20);
    expect(countWordChars('ok!')).toBe(2);
  });

  it('ignores whitespace, punctuation and emoji', () => {
    expect(countWordChars('👍')).toBe(0);
    expect(countWordChars('   ...   ')).toBe(0);
    expect(countWordChars('😂😂😂')).toBe(0);
  });

  it('handles non-latin scripts', () => {
    // Counts the letters in a non-ASCII script body.
    expect(countWordChars('مرحبا')).toBeGreaterThan(0);
  });
});

describe('classifyEchoOrigin', () => {
  const cannedReply =
    'Thanks for your message! We will get back to you shortly.';

  it('flags an instant, substantive reply as an auto-responder', () => {
    const verdict = classifyEchoOrigin({
      msSinceLastInbound: 2_000,
      text: cannedReply,
    });
    expect(verdict.isAutoResponder).toBe(true);
    expect(verdict.signals).toEqual({ instant: true, hasText: true });
  });

  it('does NOT flag a slow reply, even if it reads like a template', () => {
    // Human canned broadcasts (promos, hiring blasts) match auto-reply phrasing
    // but land hours later — latency keeps them classified as human.
    const verdict = classifyEchoOrigin({
      msSinceLastInbound: 3 * 60 * 60 * 1000, // 3 hours
      text: 'Thanks for your message — a member of our team will be in touch.',
    });
    expect(verdict.signals.instant).toBe(false);
    expect(verdict.isAutoResponder).toBe(false);
  });

  it('does NOT flag a fast but trivial human ack', () => {
    for (const text of ['ok', 'thanks', 'x', '😂', 'See you!']) {
      const verdict = classifyEchoOrigin({ msSinceLastInbound: 1_500, text });
      expect(verdict.signals.hasText).toBe(false);
      expect(verdict.isAutoResponder).toBe(false);
    }
  });

  it('does not treat a page-initiated message (no prior inbound) as instant', () => {
    const verdict = classifyEchoOrigin({
      msSinceLastInbound: null,
      text: 'Hi lovely 🤍 We are running a promo this week...',
    });
    expect(verdict.signals.instant).toBe(false);
    expect(verdict.isAutoResponder).toBe(false);
  });

  it('does not count a reply slower than the latency window as instant', () => {
    const verdict = classifyEchoOrigin({
      msSinceLastInbound: AUTO_RESPONDER_MAX_LATENCY_MS + 1,
      text: cannedReply,
    });
    expect(verdict.signals.instant).toBe(false);
    expect(verdict.isAutoResponder).toBe(false);
  });

  it('counts a reply exactly at the latency window as instant', () => {
    const verdict = classifyEchoOrigin({
      msSinceLastInbound: AUTO_RESPONDER_MAX_LATENCY_MS,
      text: cannedReply,
    });
    expect(verdict.signals.instant).toBe(true);
    expect(verdict.isAutoResponder).toBe(true);
  });

  it('ignores a negative latency (clock skew) rather than flagging it', () => {
    const verdict = classifyEchoOrigin({
      msSinceLastInbound: -500,
      text: cannedReply,
    });
    expect(verdict.signals.instant).toBe(false);
    expect(verdict.isAutoResponder).toBe(false);
  });

  it('requires at least the minimum word-char count', () => {
    const justUnder = 'a'.repeat(AUTO_RESPONDER_MIN_WORD_CHARS - 1);
    const justAt = 'a'.repeat(AUTO_RESPONDER_MIN_WORD_CHARS);
    expect(
      classifyEchoOrigin({ msSinceLastInbound: 1_000, text: justUnder })
        .isAutoResponder
    ).toBe(false);
    expect(
      classifyEchoOrigin({ msSinceLastInbound: 1_000, text: justAt })
        .isAutoResponder
    ).toBe(true);
  });
});
