import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { generateGraphicFromService } from './generate-graphic-from-service.service.js';

describe('generateGraphicFromService', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns VALIDATION_ERROR when serviceId is missing', async () => {
    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_1',
      serviceId: '',
      category: 'tips',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('accepts a missing category (defaults to tips, not a validation error)', async () => {
    // category is now optional — paid-ad graphics don't use it, and organic
    // omission defaults to `tips`. So omitting it must NOT be a validation
    // error (it falls through to the org/service lookup instead).
    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      // category omitted on purpose
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).not.toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns VALIDATION_ERROR for unknown category', async () => {
    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      // @ts-expect-error — exercising the zod guard
      category: 'not-a-real-category',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });

  it('returns NOT_FOUND when organization does not exist', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce(undefined);
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce(undefined);

    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_missing',
      serviceId: 'svc_1',
      category: 'tips',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.NOT_FOUND);
    }
  });

  // ── ENG-628 ────────────────────────────────────────────────────────────
  // An org-owned service is not necessarily THIS offer's service. The ad path
  // must reconcile the two before anything is written or enqueued.
  const adGraphicMocks = (linkedServiceIds: string[]) => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      name: 'Acme',
      primaryColor: '#6366F1',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
      name: 'Haircut',
      organizationId: 'org_1',
    });
    // 1st offer read: the ownership check in this service.
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer_1',
      organizationId: 'org_1',
    });
    // 2nd offer read: the linked-service lookup inside the guard.
    mockDb.query.offer.findFirst.mockResolvedValueOnce({
      id: 'offer_1',
      offerServices: linkedServiceIds.map((serviceId) => ({ serviceId })),
    });
  };

  it('returns VALIDATION_ERROR when the ad service is not linked to the offer', async () => {
    adGraphicMocks(['svc_OTHER']);

    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      usageType: 'ad',
      offerId: 'offer_1',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(result.error.message).toMatch(/does not belong to this offer/i);
    }
  });

  it('passes the offer/service reconciliation when the service IS linked', async () => {
    adGraphicMocks(['svc_OTHER', 'svc_1']);

    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      usageType: 'ad',
      offerId: 'offer_1',
    });

    // The render pipeline past this point is not mocked here, so the call
    // still fails — but never on the reconciliation guard.
    if (!result.success) {
      expect(result.error.message).not.toMatch(
        /does not belong to this offer/i
      );
    }
  });

  it('returns FORBIDDEN when service belongs to a different org', async () => {
    mockDb.query.organization.findFirst.mockResolvedValueOnce({
      id: 'org_1',
      name: 'Acme',
      primaryColor: '#6366F1',
    });
    mockDb.query.organizationService.findFirst.mockResolvedValueOnce({
      id: 'svc_1',
      name: 'Haircut',
      organizationId: 'org_OTHER',
    });

    const result = await generateGraphicFromService(mockDb as never, {
      organizationId: 'org_1',
      serviceId: 'svc_1',
      category: 'motivation',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.FORBIDDEN);
    }
  });
});
