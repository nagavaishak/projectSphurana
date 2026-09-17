import { logError } from '@borradh-workspace/observability';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as webhookModule from '../../../lead-forms/services/handle-meta-lead-webhook/handle-meta-lead-webhook.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import { handleFacebookLeadWebhook } from './handle-facebook-lead-webhook.service.js';

// INTERNAL module with its own suite — restored `vi.spyOn`, never `vi.mock`.
let mockHandleMetaLeadWebhook: ReturnType<typeof vi.spyOn>;

const OK = {
  success: true,
  data: { processedLeads: [{ id: 'l1' }, { id: 'l2' }], skippedCount: 3 },
};

describe('handleFacebookLeadWebhook', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockHandleMetaLeadWebhook = vi.spyOn(
      webhookModule,
      'handleMetaLeadWebhook'
    );
    mockHandleMetaLeadWebhook.mockResolvedValue(OK as never);
  });

  afterEach(() => {
    mockHandleMetaLeadWebhook.mockRestore();
  });

  it('acks with the processed/skipped counts', async () => {
    const result = await handleFacebookLeadWebhook(mockDb as never, {
      payload: '{"object":"page"}',
      signature: 'sha256=abc',
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({ success: true, processed: 2, skipped: 3 });
  });

  it('forwards the RAW payload and signature untouched', async () => {
    // Signature verification is an HMAC over these exact bytes — anything that
    // re-serialises the body silently breaks every real webhook.
    const raw = '{"object":"page","entry":[]}';
    await handleFacebookLeadWebhook(mockDb as never, {
      payload: raw,
      signature: 'sha256=abc',
    });

    expect(mockHandleMetaLeadWebhook).toHaveBeenCalledWith(
      mockDb,
      { payload: raw, signature: 'sha256=abc' },
      expect.any(String)
    );
  });

  it('returns VALIDATION_ERROR (→ 400) for an empty body', async () => {
    const result = await handleFacebookLeadWebhook(mockDb as never, {
      payload: undefined,
      signature: 'sha256=abc',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(result.error.message).toBe('Empty payload');
    expect(mockHandleMetaLeadWebhook).not.toHaveBeenCalled();
  });

  it('keeps UNAUTHORIZED as UNAUTHORIZED so a bad signature stays 401', async () => {
    mockHandleMetaLeadWebhook.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.UNAUTHORIZED, message: 'Invalid signature' },
    } as never);

    const result = await handleFacebookLeadWebhook(mockDb as never, {
      payload: '{}',
      signature: 'sha256=bad',
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    expect(result.error.message).toBe('Invalid signature');
  });

  // The entry point has always answered every non-signature failure with 400,
  // including the INTERNAL_ERROR its `trackedResult` wrapper produces. Re-coding
  // to VALIDATION_ERROR is what holds that 400 steady through `mapError`.
  it.each([ErrorCodes.INTERNAL_ERROR, ErrorCodes.VALIDATION_ERROR])(
    're-codes %s to VALIDATION_ERROR so it stays 400, preserving the message',
    async (code) => {
      mockHandleMetaLeadWebhook.mockResolvedValue({
        success: false,
        error: { code, message: 'Processing blew up' },
      } as never);

      const result = await handleFacebookLeadWebhook(mockDb as never, {
        payload: '{}',
        signature: 'sha256=abc',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toBe('Processing blew up');
    }
  );

  it('does not log a config error when the app secret is present', async () => {
    await handleFacebookLeadWebhook(mockDb as never, {
      payload: '{}',
      signature: 'sha256=abc',
    });
    expect(vi.mocked(logError)).not.toHaveBeenCalled();
  });
});
