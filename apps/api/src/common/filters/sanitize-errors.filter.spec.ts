import { logError } from '@borradh-workspace/observability';
import { HttpException, HttpStatus } from '@nestjs/common';
import { SanitizeErrorsFilter } from './sanitize-errors.filter.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
}));

const mockedLogError = logError as jest.Mock;

function buildHost(req: { method?: string; path?: string }) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const response = { status };
  return {
    host: {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => req,
      }),
    } as never,
    status,
    json,
  };
}

describe('SanitizeErrorsFilter', () => {
  const filter = new SanitizeErrorsFilter();

  beforeEach(() => jest.clearAllMocks());

  it('reports 5xx HttpExceptions to Sentry with request context', () => {
    const { host, status, json } = buildHost({
      method: 'POST',
      path: '/webhooks/meta',
    });
    const exception = new HttpException(
      'boom',
      HttpStatus.INTERNAL_SERVER_ERROR
    );

    filter.catch(exception, host);

    expect(mockedLogError).toHaveBeenCalledTimes(1);
    const [operation, reported, context] = mockedLogError.mock.calls[0];
    expect(operation).toBe('http.unhandled5xx');
    expect(reported).toBe(exception);
    expect(context.feature).toBe('http');
    expect(context.extra).toMatchObject({
      status: 500,
      method: 'POST',
      path: '/webhooks/meta',
    });
    // Client never sees the internal message.
    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'An unexpected error occurred' })
    );
  });

  it('reports unexpected non-HttpException throws to Sentry', () => {
    const { host } = buildHost({ method: 'GET', path: '/x' });
    const exception = new Error('kaboom');

    filter.catch(exception, host);

    expect(mockedLogError).toHaveBeenCalledTimes(1);
    const [operation, reported, context] = mockedLogError.mock.calls[0];
    expect(operation).toBe('http.unhandled');
    expect(reported).toBe(exception);
    expect(context.feature).toBe('http');
    expect(context.extra).toMatchObject({ method: 'GET', path: '/x' });
  });

  it('does NOT report 4xx HttpExceptions (expected client errors)', () => {
    const { host, json } = buildHost({ method: 'GET', path: '/leads/1' });

    filter.catch(new HttpException('Not found', HttpStatus.NOT_FOUND), host);

    expect(mockedLogError).not.toHaveBeenCalled();
    // 4xx message passes through to the client.
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404, message: 'Not found' })
    );
  });
});
