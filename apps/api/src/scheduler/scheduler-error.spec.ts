import { logError } from '@borradh-workspace/observability';
import {
  logSchedulerResultError,
  resetCredentialFailureSuppression,
} from './scheduler-error.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  createLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  }),
}));

const mockedLogError = logError as jest.Mock;

describe('logSchedulerResultError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCredentialFailureSuppression();
  });

  it('preserves a handled database error as the reported error cause', () => {
    const databaseError = Object.assign(new Error('connection closed'), {
      code: 'CONNECTION_CLOSED',
    });

    logSchedulerResultError('scheduler.autoClock', {
      code: 'INTERNAL_ERROR',
      message: 'Failed to list auto-clock candidates',
      cause: databaseError,
    });

    const [operation, reported, context] = mockedLogError.mock.calls[0];
    expect(operation).toBe('scheduler.autoClock');
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe('Failed to list auto-clock candidates');
    expect(reported.cause).toBe(databaseError);
    expect(context).toEqual({
      feature: 'scheduler',
      extra: { code: 'INTERNAL_ERROR' },
    });
  });

  // An orphaned preview app whose Neon branch was re-forked keeps a dead
  // password until it is redeployed. Its 60s scheduler put ~55k identical
  // 28P01 events into the production Sentry project in a week.
  it('reports an unrecoverable credential failure once, then suppresses it', () => {
    const authFailure = {
      code: 'INTERNAL_ERROR',
      message: 'Failed to publish due posts',
      details: {
        dbCode: '28P01',
        originalError: 'Failed query: select "id" from "social_post"',
      },
    };

    for (let tick = 0; tick < 50; tick++) {
      logSchedulerResultError('scheduler.publishScheduledPosts', authFailure);
    }

    expect(mockedLogError).toHaveBeenCalledTimes(1);
    const [operation, reported] = mockedLogError.mock.calls[0];
    expect(operation).toBe('scheduler.publishScheduledPosts');
    expect(reported.message).toBe(
      'Failed query: select "id" from "social_post"'
    );
  });

  it('suppresses per operation, so a second job still reports its own', () => {
    const authFailure = {
      code: 'INTERNAL_ERROR',
      message: 'auth failed',
      details: { dbCode: '28P01' },
    };

    logSchedulerResultError('scheduler.publishScheduledPosts', authFailure);
    logSchedulerResultError('scheduler.publishScheduledPosts', authFailure);
    logSchedulerResultError('scheduler.autoClock', authFailure);

    expect(mockedLogError).toHaveBeenCalledTimes(2);
    expect(mockedLogError.mock.calls.map(([op]) => op)).toEqual([
      'scheduler.publishScheduledPosts',
      'scheduler.autoClock',
    ]);
  });

  it('does not suppress ordinary query failures, which can recover', () => {
    const queryFailure = {
      code: 'INTERNAL_ERROR',
      message: 'Failed to publish due posts',
      details: { dbCode: '23505' }, // unique_violation — transient, per-row
    };

    for (let tick = 0; tick < 5; tick++) {
      logSchedulerResultError('scheduler.publishScheduledPosts', queryFailure);
    }

    expect(mockedLogError).toHaveBeenCalledTimes(5);
  });
});
