import { createHmac } from 'node:crypto';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { handleMetaDeletionCallback } from './handle-meta-deletion-callback.service.js';

const APP_SECRET = 'test-app-secret-123';
const DATA_DELETION_URL = 'https://borradh.io/data-deletion';

/**
 * Helper to create a valid Meta signed_request.
 */
function createSignedRequest(
  payload: Record<string, unknown>,
  secret: string
): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
    'base64url'
  );
  const signature = createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
  return `${signature}.${encodedPayload}`;
}

describe('handleMetaDeletionCallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns confirmation URL and code for valid signed_request', async () => {
    const signedRequest = createSignedRequest(
      { user_id: '12345', issued_at: 1700000000 },
      APP_SECRET
    );

    const result = await handleMetaDeletionCallback({
      signedRequest,
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toContain(DATA_DELETION_URL);
      expect(result.data.url).toContain('?code=');
      expect(result.data.confirmationCode).toBeTruthy();
      // Confirmation code should be a UUID
      expect(result.data.confirmationCode).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
    }
  });

  it('returns VALIDATION_ERROR for empty signed_request', async () => {
    const result = await handleMetaDeletionCallback({
      signedRequest: '',
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for malformed signed_request (no period)', async () => {
    const result = await handleMetaDeletionCallback({
      signedRequest: 'no-period-here',
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns UNAUTHORIZED for invalid signature', async () => {
    const signedRequest = createSignedRequest(
      { user_id: '12345' },
      'wrong-secret'
    );

    const result = await handleMetaDeletionCallback({
      signedRequest,
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.UNAUTHORIZED);
    }
  });

  it('returns VALIDATION_ERROR when user_id is missing from payload', async () => {
    const signedRequest = createSignedRequest(
      { issued_at: 1700000000 },
      APP_SECRET
    );

    const result = await handleMetaDeletionCallback({
      signedRequest,
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toContain('user_id');
    }
  });

  it('returns VALIDATION_ERROR for invalid dataDeletionUrl', async () => {
    const signedRequest = createSignedRequest({ user_id: '12345' }, APP_SECRET);

    const result = await handleMetaDeletionCallback({
      signedRequest,
      appSecret: APP_SECRET,
      dataDeletionUrl: 'not-a-url',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('generates unique confirmation codes for each request', async () => {
    const signedRequest = createSignedRequest({ user_id: '12345' }, APP_SECRET);

    const result1 = await handleMetaDeletionCallback({
      signedRequest,
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    const result2 = await handleMetaDeletionCallback({
      signedRequest,
      appSecret: APP_SECRET,
      dataDeletionUrl: DATA_DELETION_URL,
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
    if (result1.success && result2.success) {
      expect(result1.data.confirmationCode).not.toBe(
        result2.data.confirmationCode
      );
    }
  });
});
