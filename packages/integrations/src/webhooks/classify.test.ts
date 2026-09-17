import { describe, expect, it } from 'vitest';
import { classifyMetaMessagingEvent } from './classify.js';
import { dispositionOf, handledEventTypes } from './derive.js';
import type { MetaMessagingEvent } from './payloads.js';

const base = {
  sender: { id: 'sender-1' },
  recipient: { id: 'page-1' },
  timestamp: 1_700_000_000_000,
};

const event = (extra: Partial<MetaMessagingEvent>): MetaMessagingEvent =>
  ({ ...base, ...extra }) as MetaMessagingEvent;

describe('classifyMetaMessagingEvent', () => {
  it('attributes an inbound message to the `messages` field', () => {
    expect(
      classifyMetaMessagingEvent(
        event({ message: { mid: 'm1', text: 'hi' } }),
        'facebook_messenger'
      )
    ).toBe('messages');
  });

  it('keeps a message that CARRIES a referral on `messages` (CTM ad opens a new thread)', () => {
    const type = classifyMetaMessagingEvent(
      event({
        message: { mid: 'm1', text: 'hi', referral: { ad_id: 'ad-1' } },
      }),
      'facebook_messenger'
    );
    expect(type).toBe('messages');
    expect(dispositionOf('meta_page', type as string).kind).toBe('handled');
  });

  it('attributes a standalone referral to the plural field on Messenger and the SINGULAR one on Instagram', () => {
    const standalone = event({ referral: { ad_id: 'ad-1' } });
    expect(classifyMetaMessagingEvent(standalone, 'facebook_messenger')).toBe(
      'messaging_referrals'
    );
    expect(classifyMetaMessagingEvent(standalone, 'instagram_dm')).toBe(
      'messaging_referral'
    );
  });

  it('attributes read receipts to the field each platform actually spells', () => {
    const read = event({ read: { watermark: 1 } });
    expect(classifyMetaMessagingEvent(read, 'facebook_messenger')).toBe(
      'message_reads'
    );
    expect(classifyMetaMessagingEvent(read, 'instagram_dm')).toBe(
      'messaging_seen'
    );
  });

  it('attributes handover protocol events to messaging_handover', () => {
    const pass = event({
      pass_thread_control: { new_owner_app_id: '123' },
    } as never);
    const take = event({
      take_thread_control: { previous_owner_app_id: '123' },
    } as never);
    const req = event({
      request_thread_control: { requested_owner_app_id: '123' },
    } as never);

    expect(classifyMetaMessagingEvent(pass, 'instagram_dm')).toBe(
      'messaging_handover'
    );
    expect(classifyMetaMessagingEvent(take, 'instagram_dm')).toBe(
      'messaging_handover'
    );
    expect(classifyMetaMessagingEvent(req, 'instagram_dm')).toBe(
      'messaging_handover'
    );
  });

  it('attributes standby events to standby', () => {
    const standby = event({ standby: [{}] } as never);
    expect(classifyMetaMessagingEvent(standby, 'instagram_dm')).toBe('standby');
  });

  /**
   * Regression for API-CN / ENG-503: 359 production errors, all Instagram,
   * all with exactly these keys. The event was unclassifiable, so the router
   * logged it at error level and dropped it on every edited DM.
   */
  it('attributes an edited DM to message_edit instead of leaving it unclassifiable', () => {
    // The verbatim key set from the production event payload.
    const edited = event({ message_edit: { mid: 'm1' } } as never);

    expect(classifyMetaMessagingEvent(edited, 'instagram_dm')).toBe(
      'message_edit'
    );
    // Declared, so the router drops it quietly rather than logging `undeclared`.
    expect(dispositionOf('instagram', 'message_edit').kind).toBe('ignored');
    // Ignored events are never subscribed, so this cannot change what Meta sends.
    expect(handledEventTypes('instagram')).not.toContain('message_edit');
  });

  it('classifies every event shape to a type the registry knows about', () => {
    const shapes: Array<
      [Partial<MetaMessagingEvent>, 'facebook_messenger' | 'instagram_dm']
    > = [
      [{ message: { mid: 'm' } }, 'facebook_messenger'],
      [{ referral: { ad_id: 'a' } }, 'facebook_messenger'],
      [{ delivery: {} }, 'facebook_messenger'],
      [{ read: {} }, 'facebook_messenger'],
      [{ postback: {} }, 'facebook_messenger'],
      [{ optin: {} }, 'facebook_messenger'],
      [{ message: { mid: 'm' } }, 'instagram_dm'],
      [{ reaction: {} }, 'instagram_dm'],
      [{ read: {} }, 'instagram_dm'],
      [{ message_edit: { mid: 'm' } } as never, 'instagram_dm'],
      // Only observed on Instagram, but classification keys on payload shape,
      // not platform — so the Page side must be declared too.
      [{ message_edit: { mid: 'm' } } as never, 'facebook_messenger'],
    ];

    for (const [shape, platform] of shapes) {
      const type = classifyMetaMessagingEvent(event(shape), platform);
      expect(type).toBeDefined();
      const provider = platform === 'instagram_dm' ? 'instagram' : 'meta_page';
      // Never `undeclared`: every shape we can classify is declared in the
      // registry, handled or explicitly ignoredBecause.
      expect(dispositionOf(provider, type as string).kind).not.toBe(
        'undeclared'
      );
    }
  });

  it('returns undefined for an event carrying none of the known keys (router logs it loudly)', () => {
    expect(
      classifyMetaMessagingEvent(event({}), 'facebook_messenger')
    ).toBeUndefined();
  });
});

describe('derived subscription', () => {
  it('does not subscribe a Page to `feed` — nothing handles it', () => {
    expect(handledEventTypes('meta_page')).not.toContain('feed');
    const feed = dispositionOf('meta_page', 'feed');
    expect(feed.kind).toBe('ignored');
    if (feed.kind === 'ignored') {
      expect(feed.because).toMatch(/comment/i);
    }
  });
});
