import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectResult,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';
import { ErrorCodes } from '../../../shared/index.js';

// Stub isDraftConfigComplete with a restored spy rather than a module-wide
// `vi.mock` — the bare factory would delete every other export of
// queue-video-export.service.js on the shared worker graph (`isolate: false`).
import * as queueVideoExportModule from '../queue-video-export/queue-video-export.service.js';

import { validateDraftConfig } from './validate-draft-config.service.js';

const mocks = {
  mockIsDraftConfigComplete: undefined as unknown as MockInstance,
};

describe('validateDraftConfig', () => {
  const mockSelect = vi.fn();
  const mockFrom = vi.fn();
  const mockWhere = vi.fn();
  const mockLimit = vi.fn();

  const mockDb = { select: mockSelect } as never;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockIsDraftConfigComplete = (
      vi.spyOn(
        queueVideoExportModule,
        'isDraftConfigComplete'
      ) as unknown as MockInstance
    ).mockReturnValue(undefined);
    mockSelect.mockReturnValue({ from: mockFrom });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockWhere.mockReturnValue({ limit: mockLimit });
  });

  afterEach(() => {
    mocks.mockIsDraftConfigComplete.mockRestore();
  });

  const validInput = { id: 'video_123' };

  it('should return valid when draft config is complete', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        draftConfig: { scriptText: 'test', talkingHeadUrl: 'url' },
      },
    ]);
    mocks.mockIsDraftConfigComplete.mockReturnValueOnce(null);

    const result = await validateDraftConfig(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isValid).toBe(true);
      expect(result.data.error).toBeNull();
    }
  });

  it('should return invalid when draft config is incomplete', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        draftConfig: { scriptText: 'test' },
      },
    ]);
    mocks.mockIsDraftConfigComplete.mockReturnValueOnce(
      'Missing talking head video'
    );

    const result = await validateDraftConfig(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isValid).toBe(false);
      expect(result.data.error).toBe('Missing talking head video');
    }
  });

  it('should return invalid when no draft config', async () => {
    mockLimit.mockResolvedValueOnce([
      {
        id: 'video_123',
        draftConfig: null,
      },
    ]);

    const result = await validateDraftConfig(mockDb, validInput);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.isValid).toBe(false);
      expect(result.data.error).toBe('Video has no draft configuration');
    }
  });

  it('should return NOT_FOUND when video not found', async () => {
    mockLimit.mockResolvedValueOnce([]);

    await expectResult(validateDraftConfig(mockDb, validInput)).toFailWithCode(
      ErrorCodes.NOT_FOUND
    );
  });

  it('should return VALIDATION_ERROR for empty id', async () => {
    await expectResult(validateDraftConfig(mockDb, { id: '' })).toFailWithCode(
      ErrorCodes.VALIDATION_ERROR
    );
  });
});
