import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { getMetaIntegration } from './get-meta-integration.service.js';

describe('getMetaIntegration', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org-123',
  };

  /**
   * Helper to set up the chained select mock for the integration query.
   * The service calls: db.select(fields).from(table).leftJoin(...).where(...).limit(1)
   * Then if integration exists: db.select(fields).from(table).where(...)
   */
  const setupSelectMock = (
    integrationResult: unknown[],
    pagesResult?: unknown[]
  ) => {
    let selectCallCount = 0;

    mockDb.select.mockImplementation(() => {
      selectCallCount++;
      if (selectCallCount === 1) {
        // First call: integration query with leftJoin
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue(integrationResult),
              }),
            }),
          }),
        };
      }
      // Second call: pages query (no leftJoin)
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(pagesResult ?? []),
        }),
      };
    });
  };

  it('returns meta integration when found', async () => {
    const mockIntegration = {
      id: 'meta-456',
      configurationStatus: 'complete',
      adAccountId: 'act_123456',
      adAccountName: 'My Ad Account',
      defaultPageId: 'page-record-1',
      isActive: true,
      connectedByName: 'John Doe',
      tokenExpiresAt: new Date('2025-03-01'),
      createdAt: new Date('2024-01-01'),
      availableAdAccounts: null,
      availablePages: null,
    };

    const mockPages = [
      {
        id: 'page-record-1',
        pageId: 'page-789',
        pageName: 'My Business Page',
        platform: 'facebook',
        pixelId: 'pixel-001',
        pixelName: 'Main Pixel',
        defaultLeadFormId: 'form-123',
        defaultLeadFormName: 'Contact Form',
        isActive: true,
        createdAt: new Date('2024-01-01'),
      },
    ];

    setupSelectMock([mockIntegration], mockPages);

    const result = await getMetaIntegration(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toBeNull();
      expect(result.data?.adAccountId).toBe('act_123456');
      expect(result.data?.pages).toHaveLength(1);
      expect(result.data?.pages[0].pageName).toBe('My Business Page');
      expect(result.data?.defaultPage).not.toBeNull();
      expect(result.data?.defaultPage?.id).toBe('page-record-1');
    }
  });

  /**
   * Asserts on the PROJECTION, not the returned row — the mock hands back
   * whatever object the test supplies, so a result-shape assertion would pass
   * even with the column missing from the select. Which is how it got missed:
   * `linkedInstagramAccountId` was set on connect and read by the campaign form
   * (`hasInstagramLinked` → whether the `instagram_dm` destination is
   * selectable at all), but this endpoint — the one the form reads pages from —
   * never selected it. Result: the destination was permanently disabled for
   * every org.
   */
  it('projects the linked-Instagram columns on each page', async () => {
    const selectedFields: Record<string, unknown>[] = [];
    let selectCallCount = 0;

    mockDb.select.mockImplementation((fields: Record<string, unknown>) => {
      selectCallCount++;
      selectedFields.push(fields);
      if (selectCallCount === 1) {
        return {
          from: vi.fn().mockReturnValue({
            leftJoin: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: 'meta-456' }]),
              }),
            }),
          }),
        };
      }
      return {
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      };
    });

    await getMetaIntegration(mockDb as never, validInput);

    const pagesProjection = selectedFields[1];
    expect(pagesProjection).toBeDefined();
    expect(Object.keys(pagesProjection)).toEqual(
      expect.arrayContaining([
        'linkedInstagramAccountId',
        'linkedInstagramUsername',
        'linkedInstagramName',
      ])
    );
  });

  it('returns null when integration not found', async () => {
    setupSelectMock([]);

    const result = await getMetaIntegration(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBeNull();
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    const result = await getMetaIntegration(mockDb as never, {
      organizationId: '',
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.VALIDATION_ERROR);
    expect(mockDb.select).not.toHaveBeenCalled();
  });

  it('returns INTERNAL_ERROR on database failure', async () => {
    mockDb.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        leftJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockRejectedValue(new Error('DB error')),
          }),
        }),
      }),
    });

    const result = await getMetaIntegration(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});
