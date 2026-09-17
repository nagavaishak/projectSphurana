import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  expectResult,
  it,
  vi,
} from '@borradh-workspace/testing';
import { ErrorCodes } from '../../../shared/index.js';
import { listFaceGroups } from './list-face-groups.service.js';

describe('listFaceGroups', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    organizationId: 'org_123',
  };

  it('should return paginated face groups with defaults', async () => {
    const mockItems = [
      {
        id: 'fg_1',
        clientName: 'Jane Doe',
        clientNotes: 'Regular client',
        serviceId: 'svc_1',
        createdAt: new Date('2024-06-01'),
        service: { name: 'Botox' },
      },
      {
        id: 'fg_2',
        clientName: null,
        clientNotes: null,
        serviceId: null,
        createdAt: new Date('2024-06-02'),
        service: null,
      },
    ];

    mockDb.query.faceGroup.findMany
      .mockResolvedValueOnce(mockItems)
      .mockResolvedValueOnce([{ id: 'fg_1' }, { id: 'fg_2' }]);

    const result = await listFaceGroups(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(2);
      expect(result.data.total).toBe(2);
      expect(result.data.limit).toBe(50);
      expect(result.data.offset).toBe(0);
      expect(result.data.items[0].serviceName).toBe('Botox');
      expect(result.data.items[1].serviceName).toBeNull();
    }
  });

  it('should respect custom limit and offset', async () => {
    const input = { ...validInput, limit: 10, offset: 20 };

    mockDb.query.faceGroup.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listFaceGroups(mockDb as never, input);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.limit).toBe(10);
      expect(result.data.offset).toBe(20);
    }
  });

  it('should filter by serviceId when provided', async () => {
    const input = { ...validInput, serviceId: 'svc_1' };

    mockDb.query.faceGroup.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listFaceGroups(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(mockDb.query.faceGroup.findMany).toHaveBeenCalledTimes(2);
  });

  it('should return empty items when no face groups exist', async () => {
    mockDb.query.faceGroup.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const result = await listFaceGroups(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.items).toHaveLength(0);
      expect(result.data.total).toBe(0);
    }
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      listFaceGroups(mockDb as never, { organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for invalid limit', async () => {
    await expectResult(
      listFaceGroups(mockDb as never, { ...validInput, limit: 0 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for limit exceeding max', async () => {
    await expectResult(
      listFaceGroups(mockDb as never, { ...validInput, limit: 101 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for negative offset', async () => {
    await expectResult(
      listFaceGroups(mockDb as never, { ...validInput, offset: -1 })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
