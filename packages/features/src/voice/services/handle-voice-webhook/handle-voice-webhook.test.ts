import {
  analyzeCallOutcome,
  extractCrmUpdateData,
  inferSentiment,
  parseTelnyxWebhookEvent,
  verifyTelnyxWebhookSignature,
} from '@borradh-workspace/integrations';
import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import { handleVoiceWebhook } from './handle-voice-webhook.service.js';

const mockVerifySignature = vi.mocked(verifyTelnyxWebhookSignature);
const mockParseEvent = vi.mocked(parseTelnyxWebhookEvent);
const mockAnalyzeOutcome = vi.mocked(analyzeCallOutcome);
const mockInferSentiment = vi.mocked(inferSentiment);
const mockExtractCrmData = vi.mocked(extractCrmUpdateData);

describe('handleVoiceWebhook', () => {
  const mockDb = createMockDatabase();
  const webhookPublicKey = 'test-public-key';

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    payload: JSON.stringify({ data: { event_type: 'conversation.ended' } }),
    signature: 'valid-signature',
    timestamp: '1700000000',
  };

  it('returns VALIDATION_ERROR for empty payload', async () => {
    await expectResult(
      handleVoiceWebhook(
        mockDb as never,
        { payload: '', signature: 'sig', timestamp: '123' },
        webhookPublicKey
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty signature', async () => {
    await expectResult(
      handleVoiceWebhook(
        mockDb as never,
        { payload: 'data', signature: '', timestamp: '123' },
        webhookPublicKey
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns VALIDATION_ERROR for empty timestamp', async () => {
    await expectResult(
      handleVoiceWebhook(
        mockDb as never,
        { payload: 'data', signature: 'sig', timestamp: '' },
        webhookPublicKey
      )
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('returns UNAUTHORIZED for invalid webhook signature', async () => {
    mockVerifySignature.mockResolvedValueOnce(false);
    await expectResult(
      handleVoiceWebhook(mockDb as never, validInput, webhookPublicKey)
    ).toFailWithCode(ErrorCodes.UNAUTHORIZED);
  });

  it('returns VALIDATION_ERROR for invalid webhook payload', async () => {
    mockVerifySignature.mockResolvedValueOnce(true);
    mockParseEvent.mockImplementationOnce(() => {
      throw new Error('Invalid');
    });
    await expectResult(
      handleVoiceWebhook(mockDb as never, validInput, webhookPublicKey)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('processes conversation.ended event successfully', async () => {
    mockVerifySignature.mockResolvedValueOnce(true);
    mockParseEvent.mockReturnValueOnce({
      data: {
        event_type: 'conversation.ended',
        payload: {
          call_control_id: 'call_123',
          call_session_id: 'session_123',
          transcript: [{ role: 'assistant', content: 'Hello' }],
          status: 'completed',
          start_time: '2023-11-14T12:00:00Z',
          end_time: '2023-11-14T12:02:00Z',
          duration_seconds: 120,
        },
      },
    } as never);
    mockAnalyzeOutcome.mockReturnValue({ outcome: 'interested' } as never);
    mockInferSentiment.mockReturnValue('Positive' as never);
    mockExtractCrmData.mockReturnValue({
      appointmentBooked: false,
      callbackRequested: false,
      callbackTime: null,
      leadId: null,
      sentiment: 'Positive',
      outcome: 'interested',
      aiSummary: 'Good call',
    } as never);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);

    const result = await handleVoiceWebhook(
      mockDb as never,
      validInput,
      webhookPublicKey
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.event).toBe('conversation.ended');
      expect(result.data.processed).toBe(true);
    }
  });

  it('processes call.initiation.failed event', async () => {
    mockVerifySignature.mockResolvedValueOnce(true);
    mockParseEvent.mockReturnValueOnce({
      data: {
        event_type: 'call.initiation.failed',
        payload: { call_control_id: 'call_456', error: 'Timeout' },
      },
    } as never);
    mockDb.update.mockReturnThis();
    mockDb.set.mockReturnThis();
    mockDb.where.mockResolvedValue(undefined);

    const result = await handleVoiceWebhook(
      mockDb as never,
      validInput,
      webhookPublicKey
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.event).toBe('call.initiation.failed');
      expect(result.data.processed).toBe(true);
    }
  });
});
