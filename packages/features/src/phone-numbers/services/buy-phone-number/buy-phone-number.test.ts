import { afterEach, createMockDatabase } from '@borradh-workspace/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// ---------------------------------------------------------------------------
// Isolation note (isolate: false):
// `@borradh-workspace/env/voice` is canonically aliased in vite.config.ts. A
// hoisted per-file `vi.mock('@borradh-workspace/env/voice', ...)` installs into
// the SHARED module registry and races with whichever file loads the env
// module first. This suite toggles `TELNYX_API_KEY` on/off, which the static
// canonical mock cannot express, so we register a scoped override with
// `vi.doMock` (non-hoisted) + `vi.resetModules()` + a dynamic `import()` of the
// service inside `beforeEach`. The dynamic getter reads `__TEST_TELNYX_KEY`.
//
// Because `vi.resetModules()` re-evaluates `@borradh-workspace/integrations`,
// the Telnyx service mock is re-fetched from the SAME post-reset module graph
// the service imports — so the spy the test asserts on is the one the service
// actually calls.
// ---------------------------------------------------------------------------

// Telnyx service mock — re-fetched per test from the post-reset module graph.
let mockBuyNumber: ReturnType<typeof vi.fn>;

let buyPhoneNumber: typeof import(
  './buy-phone-number.service.js'
).buyPhoneNumber;

describe('buyPhoneNumber', () => {
  const mockDb = createMockDatabase();

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    mockDb._resetMocks();
    (globalThis as Record<string, unknown>).__TEST_TELNYX_KEY =
      'test-telnyx-key';

    vi.doMock('@borradh-workspace/env/voice', () => ({
      voiceEnv: {
        get TELNYX_API_KEY() {
          return (globalThis as Record<string, unknown>).__TEST_TELNYX_KEY as
            | string
            | undefined;
        },
      },
    }));

    ({ buyPhoneNumber } = await import('./buy-phone-number.service.js'));
    const { mockTelnyxService } = (await import(
      '@borradh-workspace/integrations'
    )) as unknown as {
      mockTelnyxService: Record<string, ReturnType<typeof vi.fn>>;
    };
    mockBuyNumber = mockTelnyxService.buyNumber;
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).__TEST_TELNYX_KEY = undefined;
    vi.doUnmock('@borradh-workspace/env/voice');
    vi.resetModules();
  });

  it('should buy a phone number with a valid plan', async () => {
    const input = {
      organizationId: 'org-1',
      phoneNumber: '+18005551234',
      label: 'Support',
      countryCode: 'US',
    };

    // Mock: subscription lookup → pro plan
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      planId: 'pro',
    });

    // Mock: count current numbers → 0
    mockDb.where.mockResolvedValueOnce([]);

    // Mock: Telnyx buy
    mockBuyNumber.mockResolvedValueOnce({
      phone_numbers: [{ id: 'telnyx-num-1' }],
    });

    // Mock: insert phone number
    mockDb.returning.mockResolvedValueOnce([
      {
        id: 'pn-1',
        organizationId: 'org-1',
        number: '+18005551234',
        provider: 'telnyx',
        providerNumberId: 'telnyx-num-1',
        status: 'active',
        label: 'Support',
      },
    ]);

    const result = await buyPhoneNumber(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.number).toBe('+18005551234');
      expect(result.data.provider).toBe('telnyx');
    }
    expect(mockBuyNumber).toHaveBeenCalledWith('+18005551234');
  });

  it('should return VALIDATION_ERROR for empty phoneNumber', async () => {
    const result = await buyPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      phoneNumber: '',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return INVALID_STATE when Telnyx API key is not configured', async () => {
    (globalThis as Record<string, unknown>).__TEST_TELNYX_KEY = undefined;

    const result = await buyPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      phoneNumber: '+18005551234',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INVALID_STATE);
    }
  });

  it('should return FORBIDDEN for free plan', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce(null); // No subscription → free plan

    const result = await buyPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      phoneNumber: '+18005551234',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
  });

  it('should return FORBIDDEN when max phone numbers reached', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      planId: 'starter', // max 1
    });

    // Already have 1 number
    mockDb.where.mockResolvedValueOnce([{ id: 'existing-1' }]);

    const result = await buyPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      phoneNumber: '+18005551234',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
  });

  it('should return INTERNAL_ERROR when Telnyx API fails', async () => {
    mockDb.query.subscriptions.findFirst.mockResolvedValueOnce({
      planId: 'pro',
    });
    mockDb.where.mockResolvedValueOnce([]);
    mockBuyNumber.mockRejectedValueOnce(new Error('Telnyx API error'));

    const result = await buyPhoneNumber(mockDb as never, {
      organizationId: 'org-1',
      phoneNumber: '+18005551234',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
