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
import { getGraphic } from './get-graphic.service.js';

describe('getGraphic', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'graphic_123',
    organizationId: 'org_123',
  };

  it('should return graphic with template when found', async () => {
    const mockGraphic = {
      id: 'graphic_123',
      title: 'Marketing Banner',
      status: 'ready',
      templateId: 'template_123',
      canvasJson: { objects: [] },
      organizationId: 'org_123',
      createdById: 'user_123',
      outputs: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      template: {
        id: 'template_123',
        name: 'Instagram Post',
        thumbnailUrl: 'https://example.com/thumb.png',
      },
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(mockGraphic);

    const result = await getGraphic(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('graphic_123');
      expect(result.data.title).toBe('Marketing Banner');
      expect(result.data.template).toBeDefined();
      expect(result.data.template?.name).toBe('Instagram Post');
    }
  });

  it('should return graphic without template', async () => {
    const mockGraphic = {
      id: 'graphic_123',
      title: 'Custom Graphic',
      status: 'draft',
      templateId: null,
      organizationId: 'org_123',
      template: null,
      createdAt: new Date(),
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(mockGraphic);

    const result = await getGraphic(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.template).toBeNull();
    }
  });

  it('should return NOT_FOUND when graphic does not exist', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    await expectResult(getGraphic(mockDb as never, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('should return NOT_FOUND when graphic belongs to different organization', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    const inputWithDifferentOrg = {
      id: 'graphic_123',
      organizationId: 'different_org',
    };

    await expectResult(
      getGraphic(mockDb as never, inputWithDifferentOrg)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
    };

    await expectResult(
      getGraphic(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'graphic_123',
      organizationId: '',
    };

    await expectResult(
      getGraphic(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockDb.query.graphic.findFirst.mockRejectedValueOnce(
      new Error('Database connection failed')
    );

    await expect(getGraphic(mockDb as never, validInput)).rejects.toThrow(
      'Database connection failed'
    );
  });
});
