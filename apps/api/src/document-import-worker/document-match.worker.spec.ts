jest.mock(
  '@borradh-workspace/database',
  () => ({ db: {}, withSystemScope: jest.fn() }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/document-imports',
  () => ({
    createDocumentMediaDeps: jest.fn(() => ({})),
    processDocumentImportJob: jest.fn(),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/jobs',
  () => ({
    documentMatchQueue: { name: 'document-match' },
    documentMatchJob: { name: 'match' },
    parseJobData: jest.fn((_def, raw) => raw),
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/shared/queue',
  () => ({ isTerminalFailure: jest.fn(), moveToDeadLetter: jest.fn() }),
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
jest.mock(
  '@borradh-workspace/storage',
  () => ({
    copy: jest.fn(),
    deleteObject: jest.fn(),
    downloadAsBuffer: jest.fn(),
    getMetadata: jest.fn(),
    getOrgAssetsBucket: jest.fn(),
    getPresignedUploadUrl: jest.fn(),
    getS3Region: jest.fn(),
  }),
  { virtual: true }
);
jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
}));

import { createDocumentMatchWorker } from './document-match.worker.js';

describe('createDocumentMatchWorker', () => {
  beforeEach(() => {
    jest.requireMock('bullmq').Worker.mockClear();
  });

  it('holds the lock long enough for two model calls plus rasterisation, one job at a time', () => {
    createDocumentMatchWorker();

    expect(jest.requireMock('bullmq').Worker).toHaveBeenCalledWith(
      'document-match',
      expect.any(Function),
      expect.objectContaining({
        concurrency: 1,
        lockDuration: 180_000,
        stalledInterval: 30_000,
        maxStalledCount: 1,
      })
    );
  });
});
