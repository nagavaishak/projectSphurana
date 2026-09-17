import { describe, expect, it } from '@borradh-workspace/testing';

import {
  META_LIKE_STICKER_ID,
  type RawMetaMessage,
  deriveMessageContent,
  isEmptyMetaMessage,
  metaHistoryToRaw,
} from './derive-message-content.js';

describe('deriveMessageContent', () => {
  describe('plain text', () => {
    it('keeps text as content with type text and null metadata', () => {
      const r = deriveMessageContent({ text: 'Hello there' });
      expect(r).toEqual({
        content: 'Hello there',
        messageType: 'text',
        metadata: null,
      });
    });

    it('trims surrounding whitespace from text', () => {
      const r = deriveMessageContent({ text: '  hi  \n' });
      expect(r.content).toBe('hi');
      expect(r.messageType).toBe('text');
    });

    it('treats whitespace-only text as no text', () => {
      const r = deriveMessageContent({ text: '   \n\t ' });
      // No other content → ultimate fallback, never blank.
      expect(r.content).toBe('[Message]');
      expect(r.content.trim().length).toBeGreaterThan(0);
    });

    it('treats null/undefined text as no text', () => {
      expect(deriveMessageContent({ text: null }).content).toBe('[Message]');
      expect(deriveMessageContent({}).content).toBe('[Message]');
    });
  });

  describe('emoji-only text', () => {
    it('preserves an emoji sent as text', () => {
      const r = deriveMessageContent({ text: '😍' });
      expect(r.content).toBe('😍');
      expect(r.messageType).toBe('text');
      expect(r.metadata).toBeNull();
    });
  });

  describe('reactions', () => {
    it('uses the reaction emoji as content', () => {
      const r = deriveMessageContent({ reaction: '❤️' });
      expect(r.content).toBe('❤️');
      expect(r.metadata).toEqual({ reaction: '❤️' });
    });

    it('text wins over reaction for content but both are kept', () => {
      const r = deriveMessageContent({ text: 'love it', reaction: '❤️' });
      expect(r.content).toBe('love it');
      expect(r.metadata).toEqual({ reaction: '❤️' });
    });
  });

  describe('stickers', () => {
    it('labels a generic sticker and captures its id', () => {
      const r = deriveMessageContent({
        attachments: [{ type: 'image', payload: { sticker_id: 12345 } }],
      });
      expect(r.content).toBe('[Sticker]');
      expect(r.messageType).toBe('attachment');
      expect(r.metadata).toEqual({ stickerId: '12345' });
    });

    it('renders the thumbs-up like sticker as 👍 and flags isLike', () => {
      const r = deriveMessageContent({
        attachments: [
          { type: 'image', payload: { sticker_id: META_LIKE_STICKER_ID } },
        ],
      });
      expect(r.content).toBe('👍');
      expect(r.metadata).toEqual({
        stickerId: META_LIKE_STICKER_ID,
        isLike: true,
      });
    });

    it('accepts a sticker id provided at the top level (history shape)', () => {
      const r = deriveMessageContent({ stickerId: 999 });
      expect(r.content).toBe('[Sticker]');
      expect(r.metadata).toEqual({ stickerId: '999' });
    });

    it('captures the sticker image url from a live attachment payload', () => {
      const r = deriveMessageContent({
        attachments: [
          {
            type: 'image',
            payload: { sticker_id: 55, url: 'https://x/y.png' },
          },
        ],
      });
      expect(r.content).toBe('[Sticker]');
      expect(r.metadata).toEqual({
        stickerId: '55',
        stickerUrl: 'https://x/y.png',
      });
    });

    it('captures a history sticker url (no id available)', () => {
      const r = deriveMessageContent({ stickerUrl: 'https://cdn/sticker.png' });
      expect(r.content).toBe('[Sticker]');
      expect(r.messageType).toBe('attachment');
      expect(r.metadata).toEqual({ stickerUrl: 'https://cdn/sticker.png' });
    });

    it('does not also list the sticker as a generic attachment', () => {
      const r = deriveMessageContent({
        attachments: [
          {
            type: 'image',
            payload: { sticker_id: 55, url: 'https://x/y.png' },
          },
        ],
      });
      expect(r.metadata?.attachments).toBeUndefined();
      expect(r.metadata?.stickerId).toBe('55');
    });
  });

  describe('attachments', () => {
    it('labels an image and captures its url', () => {
      const r = deriveMessageContent({
        attachments: [{ type: 'image', payload: { url: 'https://cdn/a.jpg' } }],
      });
      expect(r.content).toBe('📷 Photo');
      expect(r.messageType).toBe('image');
      expect(r.metadata).toEqual({
        attachments: [{ type: 'image', url: 'https://cdn/a.jpg' }],
      });
    });

    it('labels video/audio/file distinctly', () => {
      expect(
        deriveMessageContent({ attachments: [{ type: 'video' }] }).content
      ).toBe('🎥 Video');
      expect(
        deriveMessageContent({ attachments: [{ type: 'audio' }] }).content
      ).toBe('🎤 Voice message');
      expect(
        deriveMessageContent({ attachments: [{ type: 'file' }] }).content
      ).toBe('📎 File');
    });

    it('reads the url from history image_data when payload is absent', () => {
      const r = deriveMessageContent({
        attachments: [
          { type: 'image', image_data: { url: 'https://cdn/h.jpg' } },
        ],
      });
      expect(r.metadata?.attachments?.[0].url).toBe('https://cdn/h.jpg');
    });

    it('treats multiple attachments as type attachment, not image', () => {
      const r = deriveMessageContent({
        attachments: [{ type: 'image' }, { type: 'image' }],
      });
      expect(r.messageType).toBe('attachment');
      expect(r.metadata?.attachments).toHaveLength(2);
      // content labels the first attachment.
      expect(r.content).toBe('📷 Photo');
    });

    it('keeps unknown attachment types visible instead of dropping them', () => {
      const r = deriveMessageContent({
        attachments: [{ type: 'something_new' }],
      });
      expect(r.messageType).toBe('attachment');
      expect(r.content).toBe('📎 Attachment');
      expect(r.metadata?.attachments?.[0].type).toBe('unknown');
    });

    it('captures a share/fallback title', () => {
      const r = deriveMessageContent({
        attachments: [
          {
            type: 'fallback',
            payload: { title: 'Cool article', url: 'https://x' },
          },
        ],
      });
      expect(r.content).toBe('🔗 Shared link');
      expect(r.metadata?.attachments?.[0]).toEqual({
        type: 'fallback',
        url: 'https://x',
        title: 'Cool article',
      });
    });

    it('text alongside an image keeps the text as content', () => {
      const r = deriveMessageContent({
        text: 'check this out',
        attachments: [{ type: 'image', payload: { url: 'https://cdn/a.jpg' } }],
      });
      expect(r.content).toBe('check this out');
      expect(r.messageType).toBe('image');
      expect(r.metadata?.attachments?.[0].url).toBe('https://cdn/a.jpg');
    });
  });

  describe('null-safety', () => {
    it('ignores null entries in the attachments array', () => {
      const r = deriveMessageContent({
        attachments: [null, { type: 'image' }] as RawMetaMessage['attachments'],
      });
      expect(r.metadata?.attachments).toHaveLength(1);
    });

    it('never returns blank content for any shape', () => {
      const shapes: RawMetaMessage[] = [
        {},
        { text: '' },
        { text: '   ' },
        { attachments: [] },
        { attachments: [{}] },
        { attachments: [{ payload: {} }] },
        { reaction: '' },
        { stickerId: '' },
      ];
      for (const s of shapes) {
        const r = deriveMessageContent(s);
        expect(r.content.trim().length).toBeGreaterThan(0);
      }
    });
  });
});

describe('metaHistoryToRaw', () => {
  it('maps a plain text history message', () => {
    expect(metaHistoryToRaw({ message: 'hi' })).toEqual({
      text: 'hi',
      attachments: undefined,
      stickerUrl: undefined,
    });
  });

  it('maps an image attachment from image_data', () => {
    const raw = metaHistoryToRaw({
      message: '',
      attachments: {
        data: [
          { mime_type: 'image/jpeg', image_data: { url: 'https://cdn/a.jpg' } },
        ],
      },
    });
    expect(raw.attachments).toEqual([
      {
        type: 'image',
        payload: { url: 'https://cdn/a.jpg', title: undefined },
      },
    ]);
    // …and it derives to a non-blank photo label.
    expect(deriveMessageContent(raw).content).toBe('📷 Photo');
  });

  it('maps a video attachment from video_data', () => {
    const raw = metaHistoryToRaw({
      attachments: { data: [{ video_data: { url: 'https://cdn/v.mp4' } }] },
    });
    expect(raw.attachments?.[0].type).toBe('video');
    expect(deriveMessageContent(raw).content).toBe('🎥 Video');
  });

  it('maps audio and generic files by mime type', () => {
    expect(
      metaHistoryToRaw({
        attachments: {
          data: [{ mime_type: 'audio/mp4', file_url: 'https://a' }],
        },
      }).attachments?.[0].type
    ).toBe('audio');
    expect(
      metaHistoryToRaw({
        attachments: {
          data: [{ mime_type: 'application/pdf', file_url: 'https://f' }],
        },
      }).attachments?.[0].type
    ).toBe('file');
  });

  it('maps an attachment with no url/mime (CTWA ad referral) to "unknown", not "file"', () => {
    // A Click-to-Messenger ad referral comes back from history as an
    // attachment with no image_data/video_data/file_url and an empty mime.
    // It must NOT render as a misleading "📎 File" bubble.
    const raw = metaHistoryToRaw({
      attachments: { data: [{ name: null }] },
    });
    expect(raw.attachments?.[0].type).toBe('unknown');
    expect(deriveMessageContent(raw).content).toBe('📎 Attachment');
  });

  it('maps a history sticker (url only) so it derives to [Sticker]', () => {
    const raw = metaHistoryToRaw({ sticker: 'https://cdn/s.png' });
    expect(raw.stickerUrl).toBe('https://cdn/s.png');
    const d = deriveMessageContent(raw);
    expect(d.content).toBe('[Sticker]');
    expect(d.metadata).toEqual({ stickerUrl: 'https://cdn/s.png' });
  });

  it('maps shares to a share attachment', () => {
    const raw = metaHistoryToRaw({
      shares: { data: [{ link: 'https://x', name: 'A post' }] },
    });
    expect(raw.attachments).toEqual([
      { type: 'share', payload: { url: 'https://x', title: 'A post' } },
    ]);
    expect(deriveMessageContent(raw).content).toBe('🔗 Shared link');
  });

  it('an empty history message derives to a never-blank fallback', () => {
    const raw = metaHistoryToRaw({ message: '' });
    expect(isEmptyMetaMessage(raw)).toBe(true);
    expect(deriveMessageContent(raw).content).toBe('[Message]');
  });
});

describe('isEmptyMetaMessage', () => {
  it('is true for read-receipt / empty shapes', () => {
    expect(isEmptyMetaMessage({})).toBe(true);
    expect(isEmptyMetaMessage({ text: '   ' })).toBe(true);
    expect(isEmptyMetaMessage({ attachments: [] })).toBe(true);
    expect(isEmptyMetaMessage({ reaction: '' })).toBe(true);
  });

  it('is false when any renderable content is present', () => {
    expect(isEmptyMetaMessage({ text: 'hi' })).toBe(false);
    expect(isEmptyMetaMessage({ reaction: '👍' })).toBe(false);
    expect(isEmptyMetaMessage({ stickerId: 1 })).toBe(false);
    expect(isEmptyMetaMessage({ attachments: [{ type: 'image' }] })).toBe(
      false
    );
    expect(
      isEmptyMetaMessage({
        attachments: [{ type: 'image', payload: { sticker_id: 7 } }],
      })
    ).toBe(false);
  });
});
