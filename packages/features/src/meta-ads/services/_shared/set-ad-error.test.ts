import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { setAdError } from './set-ad-error.js';

const mockWhere = vi.fn().mockResolvedValue(undefined);
const mockSet = vi.fn().mockReturnValue({ where: mockWhere });
const mockUpdate = vi.fn().mockReturnValue({ set: mockSet });

const mockDb = {
  update: mockUpdate,
};

describe('setAdError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates ad status to error with syncError message', async () => {
    await setAdError(mockDb as never, 'ad-123', 'Something went wrong');

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'error',
        syncError: 'Something went wrong',
      })
    );
  });

  it('sets updatedAt to current time', async () => {
    const before = new Date();
    await setAdError(mockDb as never, 'ad-123', 'Error message');
    const after = new Date();

    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.updatedAt).toBeInstanceOf(Date);
    expect(setArg.updatedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(setArg.updatedAt.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('calls where with the correct ad ID', async () => {
    await setAdError(mockDb as never, 'ad-456', 'Test error');

    expect(mockWhere).toHaveBeenCalledTimes(1);
  });
});
