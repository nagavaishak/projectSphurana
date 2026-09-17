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
import { updateFaceGroup } from './update-face-group.service.js';

describe('updateFaceGroup', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'fg_123',
    organizationId: 'org_123',
    clientName: 'Jane Doe',
  };

  const existingGroup = {
    id: 'fg_123',
    organizationId: 'org_123',
    clientName: null,
    clientNotes: null,
    serviceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('should update clientName', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(existingGroup);

    const updatedGroup = { ...existingGroup, clientName: 'Jane Doe' };
    mockDb.returning.mockResolvedValueOnce([updatedGroup]);

    const result = await updateFaceGroup(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientName).toBe('Jane Doe');
    }
  });

  it('should update clientNotes', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(existingGroup);

    const updatedGroup = { ...existingGroup, clientNotes: 'VIP client' };
    mockDb.returning.mockResolvedValueOnce([updatedGroup]);

    const result = await updateFaceGroup(mockDb as never, {
      id: 'fg_123',
      organizationId: 'org_123',
      clientNotes: 'VIP client',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.clientNotes).toBe('VIP client');
    }
  });

  it('should update serviceId', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(existingGroup);

    const updatedGroup = { ...existingGroup, serviceId: 'svc_1' };
    mockDb.returning.mockResolvedValueOnce([updatedGroup]);

    const result = await updateFaceGroup(mockDb as never, {
      id: 'fg_123',
      organizationId: 'org_123',
      serviceId: 'svc_1',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.serviceId).toBe('svc_1');
    }
  });

  it('should return existing group when no update fields provided', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(existingGroup);

    const result = await updateFaceGroup(mockDb as never, {
      id: 'fg_123',
      organizationId: 'org_123',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('fg_123');
    }
    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when face group does not exist', async () => {
    mockDb.query.faceGroup.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      updateFaceGroup(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);

    expect(mockDb.update).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      updateFaceGroup(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      updateFaceGroup(mockDb as never, { ...validInput, organizationId: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for empty clientName', async () => {
    await expectResult(
      updateFaceGroup(mockDb as never, { ...validInput, clientName: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
