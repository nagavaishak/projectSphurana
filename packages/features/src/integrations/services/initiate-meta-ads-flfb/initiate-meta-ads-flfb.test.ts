import { trackOrgEvent } from '@borradh-workspace/observability';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';
import * as connectMetaAdsModule from '../connect-meta-ads/connect-meta-ads.service.js';
import { initiateMetaAdsFlfb } from './initiate-meta-ads-flfb.service.js';

// INTERNAL module with its own suite — restored `vi.spyOn`, never `vi.mock`.
let mockInitiate: ReturnType<typeof vi.spyOn>;

const INPUT = { organizationId: 'org-1', userId: 'user-1', code: 'code-1' };

describe('initiateMetaAdsFlfb', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockInitiate = vi.spyOn(connectMetaAdsModule, 'initiateMetaOAuth');
    mockInitiate.mockResolvedValue({
      success: true,
      data: { integrationId: 'int-1' },
    } as never);
  });

  afterEach(() => {
    mockInitiate.mockRestore();
  });

  // The popup returns its code redirect-lessly, which REQUIRES the single-call
  // system-user-token exchange rather than the classic two-step. This route can
  // never send anything else.
  it('always requests the FLFB exchange', async () => {
    const result = await initiateMetaAdsFlfb(mockDb as never, INPUT);

    expect(result.success).toBe(true);
    expect(mockInitiate).toHaveBeenCalledWith(mockDb, {
      organizationId: 'org-1',
      userId: 'user-1',
      code: 'code-1',
      flfb: true,
    });
    expect(vi.mocked(trackOrgEvent)).toHaveBeenCalledWith(
      'org-1',
      'integrations.meta_ads_connect.callback',
      { status: 'success', initiator: 'flfb-popup' }
    );
  });

  it('tracks the failure with its code and initiator', async () => {
    mockInitiate.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.VALIDATION_ERROR, message: 'Bad code' },
    } as never);

    const result = await initiateMetaAdsFlfb(mockDb as never, INPUT);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toBe('Bad code');
    expect(vi.mocked(trackOrgEvent)).toHaveBeenCalledWith(
      'org-1',
      'integrations.meta_ads_connect.callback',
      {
        status: 'connect_failed',
        errorCode: ErrorCodes.VALIDATION_ERROR,
        initiator: 'flfb-popup',
      }
    );
  });
});
