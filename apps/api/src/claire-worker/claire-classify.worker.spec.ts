jest.mock(
  '@borradh-workspace/database',
  () => ({ db: {}, withSystemScope: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/claire',
  () => ({
    CLAIRE_CLASSIFY_QUEUE: 'claire-classify',
    processClaireClassifyJob: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/observability',
  () => ({
    createLogger: () => ({
      info: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    }),
    logError: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/redis',
  () => ({
    getBullMqPrefix: () => 'test',
    getRedis: jest.fn(),
    isTransientRedisError: jest.fn(),
  }),
  { virtual: true }
);
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

import { createClaireClassifyWorker } from './claire-classify.worker.js';

describe('createClaireClassifyWorker', () => {
  beforeEach(() => {
    jest.requireMock('bullmq').Worker.mockClear();
  });

  it('keeps long-running classifier jobs locked while BullMQ renews ownership', () => {
    createClaireClassifyWorker();

    expect(jest.requireMock('bullmq').Worker).toHaveBeenCalledWith(
      'claire-classify',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 2,
        lockDuration: 120_000,
        stalledInterval: 30_000,
        maxStalledCount: 1,
      })
    );
  });
});
