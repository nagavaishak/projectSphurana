// Mock the heavy transitive chain before importing the controller. Same
// barrel-pull pattern W-C02-D / W-C05 / W-C06 / W-C07 / W-C08 used: the
// features/assistant barrel reaches ESM-only packages (cuid2, env-core)
// that swc-jest can't transform.
// `virtual: true` so jest doesn't require the real
// `@borradh-workspace/features/assistant` module to exist on disk —
// features' dist may be missing when sibling windows are mid-flight.
// The schema needs to be a real zod schema so `signUploadUrlSchema.omit(...)`
// inside `sign-upload-url.dto.ts` evaluates at module-init time.
jest.mock(
  '@borradh-workspace/features/assistant',
  () => {
    const z = require('zod');
    const signUploadUrlSchema = z.object({
      organizationId: z.string().min(1),
      userId: z.string().min(1),
      conversationId: z.string().min(1),
      mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    });
    return {
      signUploadUrl: jest.fn(),
      signUploadUrlSchema,
    };
  },
  { virtual: true }
);

jest.mock('@borradh-workspace/database', () => ({}), { virtual: true });

jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  trackedResult: <T>(_name: string, fn: () => Promise<T>) => fn(),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
}));

// `@borradh-workspace/features/shared` reaches `database/schema` →
// `@paralleldrive/cuid2` (ESM-only). swc-jest can't transform that, so we
// stub the only symbol the controller imports — `ErrorCodes`. Same
// precedent as W-C02-D's hard-blocks.spec.ts and W-C05/06/07/08 specs.
jest.mock(
  '@borradh-workspace/features/shared',
  () => ({
    ErrorCodes: {
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      INVALID_INPUT: 'INVALID_INPUT',
      UNAUTHORIZED: 'UNAUTHORIZED',
      FORBIDDEN: 'FORBIDDEN',
      NOT_FOUND: 'NOT_FOUND',
      ALREADY_EXISTS: 'ALREADY_EXISTS',
      CONFLICT: 'CONFLICT',
      INVALID_STATE: 'INVALID_STATE',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
  }),
  { virtual: true }
);

// `../common/index.ts` re-exports `auth.guard` → `@borradh-workspace/email`
// → `@t3-oss/env-core` (ESM-only). swc-jest can't transform; stub the
// surface the controller decorator-imports.
jest.mock('../common/index.js', () => ({
  AuthGuard: class {
    canActivate() {
      return true;
    }
  },
  ActiveOrganization: () => () => undefined,
  CurrentUser: () => () => undefined,
}));

import { signUploadUrl } from '@borradh-workspace/features/assistant';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { HttpException, HttpStatus } from '@nestjs/common';
import { UploadsController } from './uploads.controller.js';

const signMock = signUploadUrl as unknown as jest.Mock;

describe('UploadsController.sign', () => {
  let controller: UploadsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UploadsController();
  });

  const baseDto = { conversationId: 'conv-1', mimeType: 'image/jpeg' as const };

  it('returns the client-facing shape on success', async () => {
    const expiresAt = new Date('2026-04-25T12:05:00.000Z');
    signMock.mockResolvedValueOnce({
      success: true,
      data: {
        uploadUrl: 'https://s3.example/upload',
        downloadUrl: 'https://s3.example/download',
        s3Key: 'org/org-1/conv/conv-1/upload/abc.jpg',
        bucket: 'borradh-staging-assistant-uploads',
        expiresAt,
        contentLengthMax: 10 * 1024 * 1024,
        mimeType: 'image/jpeg',
      },
    });

    const result = await controller.sign(baseDto, 'org-1', 'user-1');

    expect(result).toEqual({
      uploadUrl: 'https://s3.example/upload',
      downloadUrl: 'https://s3.example/download',
      mimeType: 'image/jpeg',
      expiresAt: expiresAt.toISOString(),
      contentLengthMax: 10 * 1024 * 1024,
    });
    // Internal-only fields stay server-side.
    expect(result).not.toHaveProperty('bucket');
    expect(result).not.toHaveProperty('s3Key');
  });

  it('passes auth-context org + user through to the service', async () => {
    signMock.mockResolvedValueOnce({
      success: true,
      data: {
        uploadUrl: 'u',
        downloadUrl: 'd',
        s3Key: 'k',
        bucket: 'b',
        expiresAt: new Date(),
        contentLengthMax: 10 * 1024 * 1024,
        mimeType: 'image/jpeg',
      },
    });

    await controller.sign(baseDto, 'org-from-session', 'user-from-session');

    expect(signMock).toHaveBeenCalledWith({
      organizationId: 'org-from-session',
      userId: 'user-from-session',
      conversationId: 'conv-1',
      mimeType: 'image/jpeg',
    });
  });

  it('rejects with 400 when no active org is selected', async () => {
    await expect(controller.sign(baseDto, '', 'user-1')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(signMock).not.toHaveBeenCalled();
  });

  it('maps VALIDATION_ERROR → 400', async () => {
    signMock.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.VALIDATION_ERROR, message: 'bad mime' },
    });

    await expect(
      controller.sign(baseDto, 'org-1', 'user-1')
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });

  it('maps FORBIDDEN → 403', async () => {
    signMock.mockResolvedValueOnce({
      success: false,
      error: { code: ErrorCodes.FORBIDDEN, message: 'no' },
    });

    await expect(
      controller.sign(baseDto, 'org-1', 'user-1')
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
  });

  it('maps unknown error → 500 (sanitized message)', async () => {
    signMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'WEIRD_INTERNAL_DETAIL', message: 'leaks something' },
    });

    let caught: HttpException | undefined;
    try {
      await controller.sign(baseDto, 'org-1', 'user-1');
    } catch (e) {
      caught = e as HttpException;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect(caught?.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
