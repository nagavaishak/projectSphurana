const mockAcquireConversationLock = jest.fn();
const mockProcessClaireWhatsappTurn = jest.fn();
const mockWorkerOn = jest.fn();
let mockProcessor: ((job: unknown) => Promise<void>) | undefined;

jest.mock(
  '@borradh-workspace/features/assistant',
  () => ({
    CLAIRE_WHATSAPP_TURN_QUEUE: 'claire-whatsapp-turn',
  }),
  { virtual: true }
);
jest.mock(
  '@borradh-workspace/features/chatbots',
  () => ({
    acquireConversationLock: (...args: unknown[]) =>
      mockAcquireConversationLock(...args),
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
  }),
  { virtual: true }
);
jest.mock('bullmq', () => ({
  DelayedError: class DelayedError extends Error {
    constructor() {
      super('bullmq:movedToDelayed');
      this.name = 'DelayedError';
    }
  },
  Worker: jest
    .fn()
    .mockImplementation(
      (_queueName: string, processor: (job: unknown) => Promise<void>) => {
        mockProcessor = processor;
        return { on: mockWorkerOn };
      }
    ),
}));
jest.mock('./claire-whatsapp-turn.process.js', () => ({
  buildClaireWhatsappService: jest.fn(),
  processClaireWhatsappTurn: (...args: unknown[]) =>
    mockProcessClaireWhatsappTurn(...args),
}));

import { createClaireWhatsappWorker } from './claire-whatsapp.worker.js';

describe('createClaireWhatsappWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProcessor = undefined;
  });

  it('defers lock contention without running the turn or failing the job', async () => {
    mockAcquireConversationLock.mockResolvedValue({
      acquired: false,
      release: jest.fn(),
    });
    createClaireWhatsappWorker();

    const job = {
      id: 'job-1',
      token: 'worker-lock-token',
      data: {
        userId: 'user-1',
        organizationId: 'org-1',
        fromPhoneE164: '353871234567',
        userMessage: 'Second message',
        inboundMessageId: 'wamid-2',
      },
      moveToDelayed: jest.fn().mockResolvedValue(undefined),
    };

    await expect(mockProcessor?.(job)).rejects.toMatchObject({
      name: 'DelayedError',
    });

    expect(job.moveToDelayed).toHaveBeenCalledWith(
      expect.any(Number),
      'worker-lock-token'
    );
    expect(mockProcessClaireWhatsappTurn).not.toHaveBeenCalled();
  });
});
