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
import { deleteConversation } from './delete-conversation.service.js';

describe('deleteConversation', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'conv_123',
    organizationId: 'org_123',
  };

  it('should delete conversation successfully', async () => {
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([{ id: 'conv_123' }]),
      }),
    });

    const result = await deleteConversation(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.success).toBe(true);
  });

  it('should return NOT_FOUND when conversation does not exist', async () => {
    mockDb.delete.mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    });

    await expectResult(
      deleteConversation(mockDb as never, validInput)
    ).toFailWithCode(ErrorCodes.NOT_FOUND);
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    await expectResult(
      deleteConversation(mockDb as never, { ...validInput, id: '' })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });

  it('should return VALIDATION_ERROR for missing organizationId', async () => {
    await expectResult(
      deleteConversation(mockDb as never, {
        ...validInput,
        organizationId: '',
      })
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);
  });
});
