import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GRAPH_API_VERSION } from '../shared/graph-api.js';
import { MetaApiError } from '../shared/meta-api-error.js';
import { WhatsAppCloudService } from './whatsapp-cloud.service.js';

const ACCESS_TOKEN = 'test-token';
const PHONE_NUMBER_ID = '123456789';
// Derived, not pinned: the WhatsApp Cloud client used to default to v18.0 —
// three years behind the rest of the Graph calls — because the version was
// hand-typed in six places.
const API_VERSION = GRAPH_API_VERSION;

function okResponse(messageId = 'wamid.TEST'): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ messages: [{ id: messageId }] }),
    text: async () => JSON.stringify({ messages: [{ id: messageId }] }),
  } as unknown as Response;
}

function errorResponse(status = 400): Response {
  const body = {
    error: { message: 'Bad Request', code: 100, error_subcode: 33 },
  };
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe('WhatsAppCloudService.sendMediaMessage', () => {
  let service: WhatsAppCloudService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    service = new WhatsAppCloudService(ACCESS_TOKEN, PHONE_NUMBER_ID);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const expectedUrl = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  it('posts the correct URL, auth headers, and image payload (with caption)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('wamid.IMG'));

    const result = await service.sendMediaMessage('15551234567', {
      type: 'image',
      link: 'https://cdn.example.com/creative.png',
      caption: 'Your new ad',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(expectedUrl);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    });

    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551234567',
      type: 'image',
      image: {
        link: 'https://cdn.example.com/creative.png',
        caption: 'Your new ad',
      },
    });

    expect(result).toEqual({ messageId: 'wamid.IMG', success: true });
  });

  it('builds a video payload (with caption)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('wamid.VID'));

    const result = await service.sendMediaMessage('15551234567', {
      type: 'video',
      link: 'https://cdn.example.com/clip.mp4',
      caption: 'Watch this',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '15551234567',
      type: 'video',
      video: {
        link: 'https://cdn.example.com/clip.mp4',
        caption: 'Watch this',
      },
    });
    expect(result).toEqual({ messageId: 'wamid.VID', success: true });
  });

  it('omits the caption key when no caption is provided', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());

    await service.sendMediaMessage('15551234567', {
      type: 'image',
      link: 'https://cdn.example.com/creative.png',
    });

    const [, init] = fetchMock.mock.calls[0];
    const payload = JSON.parse(init.body);
    expect(payload.image).toEqual({
      link: 'https://cdn.example.com/creative.png',
    });
    expect('caption' in payload.image).toBe(false);
  });

  it('throws a MetaApiError on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400));

    await expect(
      service.sendMediaMessage('15551234567', {
        type: 'image',
        link: 'https://cdn.example.com/creative.png',
      })
    ).rejects.toBeInstanceOf(MetaApiError);
  });
});
