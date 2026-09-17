/**
 * Regression for API-EQ: "Too many requests. You can only make 10 requests per
 * second" from `campaign-send.worker`.
 *
 * The queue-wide limiter was 50/s against Resend's 10/s cap. This asserts the
 * ceiling stays at or under the tightest provider limit on the shared queue —
 * raising it again is only safe once sends are throttled per channel.
 */
import { CAMPAIGN_SEND_MAX_PER_SECOND } from './campaign-send-rate.js';

/** Resend's documented cap, and the binding constraint on this queue. */
const RESEND_REQUESTS_PER_SECOND = 10;

describe('campaign-send rate ceiling', () => {
  it('never exceeds the tightest provider cap on the shared queue', () => {
    expect(CAMPAIGN_SEND_MAX_PER_SECOND).toBeLessThanOrEqual(
      RESEND_REQUESTS_PER_SECOND
    );
  });
});
