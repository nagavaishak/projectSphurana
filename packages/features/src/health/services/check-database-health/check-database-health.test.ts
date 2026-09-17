import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import { checkDatabaseHealth } from './check-database-health.service.js';

describe('checkDatabaseHealth', () => {
  const mockDb = {
    execute: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return up status when database is healthy', async () => {
    mockDb.execute.mockResolvedValueOnce([{ '?column?': 1 }]);

    const result = await checkDatabaseHealth(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('up');
      expect(result.data.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.data.error).toBeUndefined();
    }

    expect(mockDb.execute).toHaveBeenCalled();
  });

  it('should return down status when database query fails', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await checkDatabaseHealth(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('down');
      expect(result.data.latencyMs).toBeGreaterThanOrEqual(0);
      expect(result.data.error).toBe('Connection refused');
    }
  });

  it('should return down status with unknown error for non-Error exceptions', async () => {
    mockDb.execute.mockRejectedValueOnce('string error');

    const result = await checkDatabaseHealth(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('down');
      expect(result.data.error).toBe('Unknown error');
    }
  });

  it('should measure latency accurately', async () => {
    // Simulate a slow query. Use 100ms with a 90ms assertion to give 10ms
    // of headroom for setTimeout jitter on fast CI runners.
    mockDb.execute.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return [{ '?column?': 1 }];
    });

    const result = await checkDatabaseHealth(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('up');
      expect(result.data.latencyMs).toBeGreaterThanOrEqual(90);
    }
  });

  it('should return down status for timeout errors', async () => {
    mockDb.execute.mockRejectedValueOnce(new Error('Query timeout'));

    const result = await checkDatabaseHealth(mockDb as never);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('down');
      expect(result.data.error).toBe('Query timeout');
    }
  });
});
