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
let mockReleaseNumber: ReturnType<typeof vi.fn>;

let releasePhoneNumber: typeof import(
  './release-phone-number.service.js'
).releasePhoneNumber;

describe('releasePhoneNumber', () => {
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

    ({ releasePhoneNumber } = await import(
      './release-phone-number.service.js'
    ));
    const { mockTelnyxService } = (await import(
      '@borradh-workspace/integrations'
    )) as unknown as {
      mockTelnyxService: Record<string, ReturnType<typeof vi.fn>>;
    };
    mockReleaseNumber = mockTelnyxService.releaseNumber;
    mockReleaseNumber.mockResolvedValue(undefined);
  });

  afterEach(() => {
    (globalThis as Record<string, unknown>).__TEST_TELNYX_KEY = undefined;
    vi.doUnmock('@borradh-workspace/env/voice');
    vi.resetModules();
  });

  it('should release a Telnyx phone number', async () => {
    const existing = {
      id: 'pn-1',
      organizationId: 'org-1',
      number: '+18005551234',
      provider: 'telnyx',
      providerNumberId: 'telnyx-num-1',
      status: 'active',
    };

    mockDb.query.phoneNumber.findFirst.mockResolvedValueOnce(existing);

    // Mock: update to 'releasing'
    mockDb.where.mockResolvedValueOnce(undefined);
    // Mock: update to 'released'
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await releasePhoneNumber(mockDb as never, {
      id: 'pn-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockReleaseNumber).toHaveBeenCalledWith('telnyx-num-1');
  });

  it('should release a manual phone number without calling Telnyx', async () => {
    const existing = {
      id: 'pn-2',
      organizationId: 'org-1',
      number: '+353891234567',
      provider: 'manual',
      providerNumberId: null,
      status: 'active',
    };

    mockDb.query.phoneNumber.findFirst.mockResolvedValueOnce(existing);
    mockDb.where.mockResolvedValueOnce(undefined);
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await releasePhoneNumber(mockDb as never, {
      id: 'pn-2',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(true);
    expect(mockReleaseNumber).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    const result = await releasePhoneNumber(mockDb as never, {
      id: '',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('should return NOT_FOUND when phone number does not exist', async () => {
    mockDb.query.phoneNumber.findFirst.mockResolvedValueOnce(null);

    const result = await releasePhoneNumber(mockDb as never, {
      id: 'nonexistent',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  it('should return CONFLICT when phone number is already released', async () => {
    mockDb.query.phoneNumber.findFirst.mockResolvedValueOnce({
      id: 'pn-1',
      organizationId: 'org-1',
      status: 'released',
      providerNumberId: null,
    });

    const result = await releasePhoneNumber(mockDb as never, {
      id: 'pn-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it('should return CONFLICT when phone number is already releasing', async () => {
    mockDb.query.phoneNumber.findFirst.mockResolvedValueOnce({
      id: 'pn-1',
      organizationId: 'org-1',
      status: 'releasing',
      providerNumberId: null,
    });

    const result = await releasePhoneNumber(mockDb as never, {
      id: 'pn-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.CONFLICT);
    }
  });

  it('should revert status on Telnyx API failure', async () => {
    const existing = {
      id: 'pn-1',
      organizationId: 'org-1',
      number: '+18005551234',
      provider: 'telnyx',
      providerNumberId: 'telnyx-num-1',
      status: 'active',
    };

    mockDb.query.phoneNumber.findFirst.mockResolvedValueOnce(existing);
    // Mock: update to 'releasing'
    mockDb.where.mockResolvedValueOnce(undefined);
    // Telnyx fails
    mockReleaseNumber.mockRejectedValueOnce(new Error('Telnyx API error'));
    // Mock: revert to 'active'
    mockDb.where.mockResolvedValueOnce(undefined);

    const result = await releasePhoneNumber(mockDb as never, {
      id: 'pn-1',
      organizationId: 'org-1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
    // Verify that update was called (to revert status)
    expect(mockDb.update).toHaveBeenCalled();
  });
});
