import { describe, expect, it } from 'vitest';
import { classifyMetaMessagingEvent } from './classify.js';
import { metaMessagingEventSchema } from './payloads.js';

/**
 * INGRESS PERMISSIVENESS.
 *
 * The controller `safeParse`s each `entry[].messaging[]` element and, on
 * failure, logs and `continue`s — still returning 200. Meta NEVER retries a 200.
 * So a field required here that Meta omits is not "validation": it is a real
 * customer message deleted, silently, forever. That is the exact shape of a
 * chatbot outage nobody notices.
 *
 * These tests pin the schema to the promise in its own docblock ("deliberately
 * PERMISSIVE") and to the downstream contract
 * (`handle-incoming-message.schema.ts`), which treats messageId / timestamp /
 * attachment type / attachment payload as optional. If you tighten a field here,
 * one of these fails — that is the point.
 */
describe('metaMessagingEventSchema — ingress must not drop real messages', () => {
  const sender = { id: 'sender-1' };
  const recipient = { id: 'page-1' };

  it('accepts a plain inbound text message', () => {
    const r = metaMessagingEventSchema.safeParse({
      sender,
      recipient,
      timestamp: 1_700_000_000,
      message: { mid: 'm_1', text: 'do you have anything friday?' },
    });
    expect(r.success).toBe(true);
  });

  it.each<[string, Record<string, unknown>]>([
    // Each of these was REQUIRED at one point; each would have 200-dropped a
    // real message. Downstream treats every one of them as optional.
    ['message with no mid', { message: { text: 'hi' } }],
    ['event with no timestamp', { message: { mid: 'm_2', text: 'hi' } }],
    [
      'attachment with no payload (e.g. a bare fallback)',
      { message: { mid: 'm_3', attachments: [{ type: 'fallback' }] } },
    ],
    [
      'attachment with no type',
      {
        message: {
          mid: 'm_4',
          attachments: [{ payload: { url: 'https://x/y.jpg' } }],
        },
      },
    ],
    [
      'attachment with neither type nor payload',
      { message: { mid: 'm_5', attachments: [{}] } },
    ],
  ])('accepts: %s', (_label, partial) => {
    const r = metaMessagingEventSchema.safeParse({
      sender,
      recipient,
      ...partial,
    });
    expect(r.success).toBe(true);
  });

  it('accepts unknown provider fields — Meta adds them without warning', () => {
    const r = metaMessagingEventSchema.safeParse({
      sender,
      recipient,
      timestamp: 1,
      message: {
        mid: 'm_6',
        text: 'hi',
        some_future_meta_field: { nested: true },
      },
      another_new_top_level_field: 'x',
    });
    expect(r.success).toBe(true);
  });

  it.each<['facebook_messenger' | 'instagram_dm']>([
    ['facebook_messenger'],
    ['instagram_dm'],
  ])(
    'a message missing mid/timestamp still classifies as `messages` (%s)',
    (platform) => {
      // Parsing is only half of it — the classifier must still route the
      // survivor to handleIncomingMessage, not treat it as an ignorable event.
      const parsed = metaMessagingEventSchema.parse({
        sender,
        recipient,
        message: { text: 'still a real customer' },
      });
      expect(classifyMetaMessagingEvent(parsed, platform)).toBe('messages');
    }
  );
});
