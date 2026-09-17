import { createHmac } from 'node:crypto';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { handleWhatsAppWebhook } from './handle-whatsapp-webhook.service.js';

describe('handleWhatsAppWebhook', () => {
  const mockDb = createMockDatabase();
  const appSecret = 'test_app_secret';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  function signPayload(payload: string): string {
    const hash = createHmac('sha256', appSecret).update(payload).digest('hex');
    return `sha256=${hash}`;
  }

  const makeMessagePayload = () =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: {
                  phone_number_id: 'phone-123',
                  display_phone_number: '+1234567890',
                },
                messages: [
                  {
                    id: 'msg-1',
                    from: '15551234567',
                    timestamp: '1700000000',
                    type: 'text',
                    text: { body: 'Hello there' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

  const makeStatusPayload = () =>
    JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'phone-123' },
                statuses: [
                  {
                    id: 'msg-1',
                    recipient_id: '15551234567',
                    timestamp: '1700000000',
                    status: 'delivered',
                  },
                ],
              },
            },
          ],
        },
      ],
    });

  it('processes incoming message events successfully', async () => {
    const payload = makeMessagePayload();
    const signature = signPayload(payload);

    const result = await handleWhatsAppWebhook(
      mockDb as never,
      { payload, signature },
      appSecret
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(true);
      expect(result.data.events).toHaveLength(1);
      expect(result.data.events[0].type).toBe('message');
      expect(result.data.events[0].from).toBe('15551234567');
      expect(result.data.events[0].body).toBe('Hello there');
    }
  });

  it('processes status update events successfully', async () => {
    const payload = makeStatusPayload();
    const signature = signPayload(payload);

    const result = await handleWhatsAppWebhook(
      mockDb as never,
      { payload, signature },
      appSecret
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(true);
      expect(result.data.events).toHaveLength(1);
      expect(result.data.events[0].type).toBe('status');
      expect(result.data.events[0].status).toBe('delivered');
    }
  });

  it('returns processed=false when no processable events', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    const signature = signPayload(payload);

    const result = await handleWhatsAppWebhook(
      mockDb as never,
      { payload, signature },
      appSecret
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(false);
      expect(result.data.events).toHaveLength(0);
    }
  });

  it('returns processed=false for non-whatsapp objects', async () => {
    const payload = JSON.stringify({ object: 'page', entry: [] });
    const signature = signPayload(payload);

    const result = await handleWhatsAppWebhook(
      mockDb as never,
      { payload, signature },
      appSecret
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.processed).toBe(false);
    }
  });

  it('returns UNAUTHORIZED for invalid signature', async () => {
    const payload = makeMessagePayload();

    await expectResult(
      handleWhatsAppWebhook(
        mockDb as never,
        { payload, signature: 'sha256=invalid' },
        appSecret
      )
    ).toFailWithCode(ErrorCodes.UNAUTHORIZED);
  });

  it('returns UNAUTHORIZED for signature without sha256 prefix', async () => {
    const payload = makeMessagePayload();

    await expectResult(
      handleWhatsAppWebhook(
        mockDb as never,
        { payload, signature: 'invalid_no_prefix' },
        appSecret
      )
    ).toFailWithCode(ErrorCodes.UNAUTHORIZED);
  });

  it('returns VALIDATION_ERROR for missing payload', async () => {
    await expectResult(
      handleWhatsAppWebhook(
        mockDb as never,
        { payload: '', signature: 'sha256=abc' },
        appSecret
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for missing signature', async () => {
    await expectResult(
      handleWhatsAppWebhook(
        mockDb as never,
        { payload: 'test', signature: '' },
        appSecret
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
