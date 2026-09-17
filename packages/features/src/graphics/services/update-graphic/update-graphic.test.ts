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
import { updateGraphic } from './update-graphic.service.js';

describe('updateGraphic', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'graphic_123',
    organizationId: 'org_123',
    title: 'Updated Title',
  };

  it('should update graphic with valid input', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      title: 'Original Title',
      status: 'draft',
      organizationId: 'org_123',
      createdAt: new Date(),
    };

    const updatedGraphic = {
      ...existingGraphic,
      title: 'Updated Title',
      updatedAt: new Date(),
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    mockDb.returning.mockResolvedValueOnce([updatedGraphic]);

    const result = await updateGraphic(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.title).toBe('Updated Title');
    }

    expect(mockDb.update).toHaveBeenCalled();
  });

  // Skipped: `canvasJson` / per-slide editing is no longer part of
  // `updateGraphic`. The Fabric editor save path lives on
  // `updateGraphicScene`, which writes the full `BorradhFabricScene` to
  // `graphic.fabricScene`. This service now only updates metadata
  // (title, status, aspectRatio, canvas dimensions).
  it.skip('should update canvasJson', async () => {
    // intentionally empty — see comment above.
  });

  it('should update status', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      status: 'draft',
      organizationId: 'org_123',
    };

    const updateInput = {
      id: 'graphic_123',
      organizationId: 'org_123',
      status: 'ready' as const,
    };

    const updatedGraphic = {
      ...existingGraphic,
      status: 'ready',
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    mockDb.returning.mockResolvedValueOnce([updatedGraphic]);

    const result = await updateGraphic(mockDb as never, updateInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ready');
    }
  });

  it('should return NOT_FOUND when graphic does not exist', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateGraphic(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when graphic belongs to different organization', async () => {
    mockDb.query.graphic.findFirst.mockResolvedValueOnce(null);

    const inputWithDifferentOrg = {
      ...validInput,
      organizationId: 'different_org',
    };

    await expectResult(
      updateGraphic(mockDb as never, inputWithDifferentOrg)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {
      id: '',
      organizationId: 'org_123',
      title: 'New Title',
    };

    await expectResult(
      updateGraphic(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    const invalidInput = {
      id: 'graphic_123',
      organizationId: '',
      title: 'New Title',
    };

    await expectResult(
      updateGraphic(mockDb as never, invalidInput)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.query.graphic.findFirst).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    const existingGraphic = {
      id: 'graphic_123',
      organizationId: 'org_123',
    };

    mockDb.query.graphic.findFirst.mockResolvedValueOnce(existingGraphic);
    mockDb.returning.mockRejectedValueOnce(new Error('Database error'));

    const result = await updateGraphic(mockDb as never, validInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    }
  });
});
