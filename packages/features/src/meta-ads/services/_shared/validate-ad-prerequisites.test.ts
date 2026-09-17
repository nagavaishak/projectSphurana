import { beforeEach, describe, expect, it } from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { AdErrorCodes } from '../../models/index.js';

import {
  validateInstagramProfile,
  validatePaymentMethod,
} from './validate-ad-prerequisites.js';

const createMockMetaService = () => ({
  getInstagramAccountInfo: vi.fn(),
  hasPaymentMethod: vi.fn(),
});

describe('validateInstagramProfile', () => {
  let metaService: ReturnType<typeof createMockMetaService>;

  beforeEach(() => {
    vi.clearAllMocks();
    metaService = createMockMetaService();
  });

  it('passes when no Instagram account linked (skip check)', async () => {
    const result = await validateInstagramProfile(metaService as never, null);
    expect(result.success).toBe(true);
    expect(metaService.getInstagramAccountInfo).not.toHaveBeenCalled();
  });

  it('passes when Instagram profile has picture', async () => {
    metaService.getInstagramAccountInfo.mockResolvedValueOnce({
      hasProfilePicture: true,
      username: 'testuser',
    });

    const result = await validateInstagramProfile(
      metaService as never,
      'ig-account-001'
    );

    expect(result.success).toBe(true);
  });

  it('fails when Instagram profile has no picture', async () => {
    metaService.getInstagramAccountInfo.mockResolvedValueOnce({
      hasProfilePicture: false,
      username: 'testuser',
    });

    const result = await validateInstagramProfile(
      metaService as never,
      'ig-account-001',
      'testuser'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.META_AD_CREATE_FAILED);
      expect(result.error.message).toContain('@testuser');
      expect(result.error.message).toContain('profile photo');
    }
  });

  it('passes when Meta API error (non-fatal)', async () => {
    metaService.getInstagramAccountInfo.mockRejectedValueOnce(
      new Error('API timeout')
    );

    const result = await validateInstagramProfile(
      metaService as never,
      'ig-account-001'
    );

    expect(result.success).toBe(true);
  });

  it('uses linkedInstagramUsername as fallback in error message', async () => {
    metaService.getInstagramAccountInfo.mockResolvedValueOnce({
      hasProfilePicture: false,
      username: null,
    });

    const result = await validateInstagramProfile(
      metaService as never,
      'ig-account-001',
      'fallback_username'
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('@fallback_username');
    }
  });
});

describe('validatePaymentMethod', () => {
  let metaService: ReturnType<typeof createMockMetaService>;

  beforeEach(() => {
    vi.clearAllMocks();
    metaService = createMockMetaService();
  });

  it('passes when payment method exists', async () => {
    metaService.hasPaymentMethod.mockResolvedValueOnce(true);

    const result = await validatePaymentMethod(metaService as never);

    expect(result.success).toBe(true);
  });

  it('fails when no payment method configured', async () => {
    metaService.hasPaymentMethod.mockResolvedValueOnce(false);

    const result = await validatePaymentMethod(metaService as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(AdErrorCodes.META_PAYMENT_METHOD_REQUIRED);
      expect(result.error.message).toContain('payment method');
    }
  });
});
