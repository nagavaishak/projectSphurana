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
import {
  listServiceIdsWithMedia,
  listServiceIdsWithVideoFootage,
} from './list-services-with-media.service.js';

describe('listServiceIdsWithMedia', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the distinct service ids the query yields', async () => {
    // The eligibility predicate (image OR video-with-thumbnail) is enforced in
    // SQL; the service just maps the rows the DB returns.
    mockDb.where.mockResolvedValueOnce([
      { serviceId: 'svc_1' },
      { serviceId: 'svc_2' },
    ]);

    const result = await listServiceIdsWithMedia(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['svc_1', 'svc_2']);
    }
  });

  it('returns an empty array when no service has eligible media', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    const result = await listServiceIdsWithMedia(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listServiceIdsWithMedia(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.selectDistinct).not.toHaveBeenCalled();
  });
});

describe('listServiceIdsWithVideoFootage', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  it('returns the distinct service ids with their own video clips', async () => {
    // The video-footage predicate (type = video) is enforced in SQL; the
    // service just maps the rows the DB returns.
    mockDb.where.mockResolvedValueOnce([
      { serviceId: 'svc_1' },
      { serviceId: 'svc_3' },
    ]);

    const result = await listServiceIdsWithVideoFootage(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(['svc_1', 'svc_3']);
    }
  });

  it('returns an empty array when no service has video footage', async () => {
    mockDb.where.mockResolvedValueOnce([]);

    const result = await listServiceIdsWithVideoFootage(mockDb as never, {
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('returns VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listServiceIdsWithVideoFootage(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.selectDistinct).not.toHaveBeenCalled();
  });
});
