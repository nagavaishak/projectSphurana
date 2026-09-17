import { createMockDatabase } from '@borradh-workspace/testing';
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as getSubscriptionModule from '../../../billing/services/get-subscription/get-subscription.service.js';
import * as getOrganizationModule from '../../../organizations/services/get-organization/get-organization.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as listApiKeysModule from '../list-api-keys/list-api-keys.service.js';
import { prepareApiKeyCreation } from './prepare-api-key-creation.service.js';

// `vi.spyOn`, NOT `vi.mock`: under `isolate: false` a hoisted factory mock
// leaks into every later file in the worker.
let getOrganization: MockInstance;
let getSubscription: MockInstance;
let listApiKeys: MockInstance;

const org = { id: 'org-1', name: 'Glow Clinic', slug: 'glow' };

describe('prepareApiKeyCreation', () => {
  let mockDb: ReturnType<typeof createMockDatabase>;

  const input = { organizationId: 'org-1' };

  const onPlan = (planId: string) => {
    getSubscription.mockResolvedValueOnce({
      success: true,
      data: { planId },
    } as never);
  };

  const hasKeys = (count: number) => {
    listApiKeys.mockResolvedValueOnce({
      success: true,
      data: {
        items: Array.from({ length: count }, (_, i) => ({ id: `k${i}` })),
      },
    } as never);
  };

  beforeEach(() => {
    mockDb = createMockDatabase();
    vi.clearAllMocks();
    getOrganization = vi
      .spyOn(getOrganizationModule, 'getOrganization')
      .mockResolvedValue({ success: true, data: org } as never);
    getSubscription = vi
      .spyOn(getSubscriptionModule, 'getSubscription')
      .mockResolvedValue({
        success: false,
        error: {
          code: ErrorCodes.NOT_FOUND,
          message: 'Subscription not found',
        },
      } as never);
    listApiKeys = vi
      .spyOn(listApiKeysModule, 'listApiKeys')
      .mockResolvedValue({ success: true, data: { items: [] } } as never);
  });

  afterEach(() => {
    getOrganization.mockRestore();
    getSubscription.mockRestore();
    listApiKeys.mockRestore();
  });

  it('returns org metadata and the plan rate limit', async () => {
    onPlan('pro');
    hasKeys(2);

    const result = await prepareApiKeyCreation(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        organizationName: 'Glow Clinic',
        organizationSlug: 'glow',
        rateLimitMax: 2000,
      });
    }
  });

  it('returns NOT_FOUND when the organization is missing', async () => {
    getOrganization.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.NOT_FOUND, message: 'Organization with ID x' },
    } as never);

    const result = await prepareApiKeyCreation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(result.error.message).toBe('Organization not found');
    }
    expect(getSubscription).not.toHaveBeenCalled();
  });

  it('returns FORBIDDEN when the plan has no API access', async () => {
    onPlan('free');

    const result = await prepareApiKeyCreation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.error.message).toBe('API access requires a paid plan');
    }
    expect(listApiKeys).not.toHaveBeenCalled();
  });

  it('treats a missing subscription as the free plan', async () => {
    const result = await prepareApiKeyCreation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
  });

  it('returns FORBIDDEN when the key quota is already used up', async () => {
    onPlan('starter');
    hasKeys(3);

    const result = await prepareApiKeyCreation(mockDb as never, input);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
      expect(result.error.message).toBe(
        'Maximum of 3 API keys allowed on your plan'
      );
    }
  });

  it('does not block creation when the key lookup fails', async () => {
    onPlan('starter');
    listApiKeys.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'db down' },
    } as never);

    const result = await prepareApiKeyCreation(mockDb as never, input);

    expect(result.success).toBe(true);
  });

  it('returns VALIDATION_ERROR for a missing organizationId', async () => {
    const result = await prepareApiKeyCreation(mockDb as never, {} as never);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
    expect(getOrganization).not.toHaveBeenCalled();
  });
});
