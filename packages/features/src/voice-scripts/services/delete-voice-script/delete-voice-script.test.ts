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
import { deleteVoiceScript } from './delete-voice-script.service.js';

describe('deleteVoiceScript', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  const validInput = {
    id: 'script_123',
    organizationId: 'org_123',
  };

  it('should delete voice script successfully', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Script to Delete',
      isDefault: false,
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([existingScript]);

    const result = await deleteVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.success).toBe(true);
    }
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should delete default script when other scripts exist', async () => {
    const defaultScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Default Script',
      isDefault: true,
    };

    const otherScripts = [
      defaultScript,
      {
        id: 'script_456',
        organizationId: 'org_123',
        name: 'Other Script',
        isDefault: false,
      },
    ];

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(defaultScript);
    mockDb.query.voiceScript.findMany.mockResolvedValueOnce(otherScripts);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockResolvedValueOnce([defaultScript]);

    const result = await deleteVoiceScript(mockDb as never, validInput);

    expect(result.success).toBe(true);
    expect(mockDb.delete).toHaveBeenCalled();
  });

  it('should return CONFLICT when deleting only script and it is default', async () => {
    const onlyDefaultScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Only Default Script',
      isDefault: true,
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(onlyDefaultScript);
    mockDb.query.voiceScript.findMany.mockResolvedValueOnce([
      onlyDefaultScript,
    ]);

    await expectResult(
      deleteVoiceScript(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.CONFLICT);
      expect(error.message).toContain('Cannot delete the only voice script');
    });

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return NOT_FOUND when script does not exist', async () => {
    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(null);

    await expectResult(
      deleteVoiceScript(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.NOT_FOUND);
      expect(error.message).toBe('Voice script not found');
    });

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return VALIDATION_ERROR for missing id', async () => {
    const invalidInput = {};

    await expectResult(
      deleteVoiceScript(mockDb as never, invalidInput as never)
    ).toFailWithCode(ErrorCodes.VALIDATION_ERROR);

    expect(mockDb.delete).not.toHaveBeenCalled();
  });

  it('should return INTERNAL_ERROR on database failure', async () => {
    const existingScript = {
      id: 'script_123',
      organizationId: 'org_123',
      name: 'Script',
      isDefault: false,
    };

    mockDb.query.voiceScript.findFirst.mockResolvedValueOnce(existingScript);
    mockDb.delete.mockReturnThis();
    mockDb.where.mockRejectedValueOnce(new Error('DB failed'));

    await expectResult(
      deleteVoiceScript(mockDb as never, validInput)
    ).toFailWith((error) => {
      expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
      expect(error.message).toBe('Failed to delete voice script');
    });
  });
});
