import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetaMessagingService } from '../../meta-messaging/meta-messaging.service.js';
import { WhatsAppCloudService } from '../../whatsapp/whatsapp-cloud.service.js';
import {
  captureRequest,
  expectMatchesContract,
  okResponse,
} from '../testing.js';

/**
 * REQUEST-CONTRACT TESTS — outbound messaging.
 *
 * The other path where a parameter change breaks delivery silently. A malformed
 * Messenger or WhatsApp payload doesn't crash anything visible: the bot simply
 * stops replying, which is exactly the class of bug that reads as "Claire isn't
 * responding" days later.
 *
 * Same shared registry as the ads contracts and the fake, so all three agree.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Messenger
// ─────────────────────────────────────────────────────────────────────────────

describe('MetaMessagingService', () => {
  const RECIPIENT = 'psid-123';
  let service: MetaMessagingService;

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      okResponse({ recipient_id: RECIPIENT, message_id: 'mid.1' })
    );
    service = new MetaMessagingService('page-token', 'page-1');
  });

  it('sendTextMessage satisfies the contract', async () => {
    await service.sendTextMessage(RECIPIENT, 'Hello there');

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'messaging.send'
    );

    expect(payload.recipient).toEqual({ id: RECIPIENT });
    expect(payload.message).toEqual({ text: 'Hello there' });
    // RESPONSE keeps us inside the standard messaging window; dropping it is a
    // silent delivery failure outside 24h.
    expect(payload.messaging_type).toBe('RESPONSE');
  });

  it('sendQuickReply satisfies the contract and snake_cases the options', async () => {
    await service.sendQuickReply(RECIPIENT, 'Pick one', [
      { contentType: 'text', title: 'Book', payload: 'BOOK' },
      { contentType: 'text', title: 'Prices', payload: 'PRICES' },
    ]);

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'messaging.send'
    );
    const message = payload.message as Record<string, unknown>;

    // Meta requires snake_case here; camelCase is accepted-then-ignored, so the
    // buttons silently vanish.
    expect(message.quick_replies).toEqual([
      { content_type: 'text', title: 'Book', payload: 'BOOK' },
      { content_type: 'text', title: 'Prices', payload: 'PRICES' },
    ]);
  });

  it.each(['image', 'video', 'audio', 'file'] as const)(
    'sendAttachment satisfies the contract for %s',
    async (type) => {
      await service.sendAttachment(
        RECIPIENT,
        type,
        'https://cdn.borradh.io/a.jpg?Signature=x'
      );

      const payload = expectMatchesContract(
        captureRequest(fetchMock),
        'messaging.send'
      );
      const message = payload.message as Record<string, unknown>;

      expect(message.attachment).toEqual({
        type,
        payload: {
          url: 'https://cdn.borradh.io/a.jpg?Signature=x',
          is_reusable: true,
        },
      });
    }
  );

  it('sendSenderAction satisfies the contract', async () => {
    // This is the call that produced Meta error 100/2018048 in production and
    // killed Claire's Messenger replies — worth a contract of its own.
    await service.sendSenderAction(RECIPIENT, 'typing_on');

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'messaging.send'
    );

    expect(payload.sender_action).toBe('typing_on');
    expect(payload.message).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Cloud
// ─────────────────────────────────────────────────────────────────────────────

describe('WhatsAppCloudService', () => {
  const TO = '353850000000';
  let service: WhatsAppCloudService;

  beforeEach(() => {
    fetchMock.mockResolvedValue(
      okResponse({ messages: [{ id: 'wamid.TEST' }] })
    );
    service = new WhatsAppCloudService('wa-token', 'phone-1');
  });

  it('sendTextMessage satisfies the contract', async () => {
    await service.sendTextMessage(TO, 'Hi from Claire');

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'whatsapp.sendMessage'
    );

    expect(payload.messaging_product).toBe('whatsapp');
    expect(payload.recipient_type).toBe('individual');
    expect(payload.to).toBe(TO);
    expect(payload.type).toBe('text');
    expect(payload.text).toEqual({ body: 'Hi from Claire' });
  });

  it.each(['image', 'video'] as const)(
    'sendMediaMessage satisfies the contract for %s',
    async (type) => {
      await service.sendMediaMessage(TO, {
        type,
        link: 'https://cdn.borradh.io/media.mp4?Signature=x',
        caption: 'Take a look',
      });

      const payload = expectMatchesContract(
        captureRequest(fetchMock),
        'whatsapp.sendMessage'
      );

      expect(payload.type).toBe(type);
      // The media object is keyed by TYPE, not a generic `media` field.
      expect(payload[type]).toMatchObject({
        link: 'https://cdn.borradh.io/media.mp4?Signature=x',
        caption: 'Take a look',
      });
    }
  );

  it('sendTemplateMessage satisfies the contract without parameters', async () => {
    await service.sendTemplateMessage({
      to: TO,
      templateName: 'appointment_reminder',
      languageCode: 'en',
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'whatsapp.sendMessage'
    );
    const template = payload.template as Record<string, unknown>;

    expect(payload.type).toBe('template');
    expect(template.name).toBe('appointment_reminder');
    expect(template.language).toEqual({ code: 'en' });
    // No parameters → no components key at all (an empty array is rejected).
    expect(template.components).toBeUndefined();
  });

  it('sendTemplateMessage builds body components from parameters', async () => {
    await service.sendTemplateMessage({
      to: TO,
      templateName: 'appointment_reminder',
      languageCode: 'en',
      parameters: { name: 'Dana', time: '3pm' },
    });

    const payload = expectMatchesContract(
      captureRequest(fetchMock),
      'whatsapp.sendMessage'
    );
    const template = payload.template as Record<string, unknown>;

    expect(template.components).toEqual([
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Dana' },
          { type: 'text', text: '3pm' },
        ],
      },
    ]);
  });
});
