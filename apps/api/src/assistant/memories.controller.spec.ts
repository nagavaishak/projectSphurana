// Mock the heavy transitive chain before importing the controller. Same
// barrel-pull pattern uploads.controller.spec.ts uses: the
// features/assistant barrel reaches ESM-only packages (cuid2, env-core)
// that swc-jest can't transform.
// `virtual: true` so jest doesn't require the real
// `@borradh-workspace/features/assistant` module to exist on disk —
// features' dist may be missing when sibling windows are mid-flight.
// Schemas need to be real zod schemas so `omit(...)` inside the DTO files
// evaluates at module-init time.
jest.mock(
  '@borradh-workspace/features/assistant',
  () => {
    const z = require('zod');
    const listMemoriesSchema = z.object({
      organizationId: z.string().min(1),
      userId: z.string().min(1),
      type: z.enum(['preference']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
      offset: z.number().int().min(0).optional(),
    });
    const editMemorySchema = z.object({
      id: z.string().min(1),
      organizationId: z.string().min(1),
      userId: z.string().min(1),
      content: z.string().min(1).max(2000),
    });
    // Content rules are memories too — same store, narrowed. The schema has to
    // be a real zod object because `SaveContentRuleDto` calls `.omit()` on it
    // at module-init time.
    const saveContentRuleSchema = z.object({
      organizationId: z.string().min(1),
      title: z.string().min(1).max(80),
      content: z.string().min(1).max(280),
      batchId: z.string().min(1).optional(),
    });
    return {
      listMemories: jest.fn(),
      editMemory: jest.fn(),
      deleteMemory: jest.fn(),
      listContentRules: jest.fn(),
      saveContentRule: jest.fn(),
      listMemoriesSchema,
      editMemorySchema,
      saveContentRuleSchema,
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
// stub the only symbols the controller imports. Same precedent as
// `uploads.controller.spec.ts`.
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

import {
  deleteMemory,
  editMemory,
  listMemories,
} from '@borradh-workspace/features/assistant';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { HttpException, HttpStatus } from '@nestjs/common';
import { MemoriesController } from './memories.controller.js';

const listMock = listMemories as unknown as jest.Mock;
const editMock = editMemory as unknown as jest.Mock;
const deleteMock = deleteMemory as unknown as jest.Mock;

const baseMemoryRow = {
  id: 'mem-1',
  organizationId: 'org-1',
  type: 'preference',
  title: 'Memory: warm tones',
  content: 'I prefer warm color palettes.',
  source: 'manual',
  confidence: 1,
  metadata: { savedBy: 'user-1', scope: 'personal' },
  createdAt: '2026-04-26T10:00:00.000Z',
  updatedAt: '2026-04-26T10:00:00.000Z',
};

describe('MemoriesController', () => {
  let controller: MemoriesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MemoriesController();
  });

  describe('list', () => {
    it('returns the service payload untouched', async () => {
      // `listMemories` already emits the wire shape (scope + ISO timestamps);
      // the controller must not reshape it. Serialization itself is covered by
      // `packages/features/src/assistant/services/list-memories`.
      const payload = {
        items: [
          { ...baseMemoryRow, userId: 'user-1', scope: 'personal' },
          {
            ...baseMemoryRow,
            id: 'mem-2',
            userId: null,
            scope: 'organization',
            title: 'Team memory: no Sunday ads',
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      };
      listMock.mockResolvedValueOnce({ success: true, data: payload });

      const result = await controller.list({}, 'org-1', 'user-1');

      expect(result).toBe(payload);
    });

    it('passes optional limit/offset through to the service', async () => {
      listMock.mockResolvedValueOnce({
        success: true,
        data: { items: [], total: 0, limit: 10, offset: 20 },
      });

      await controller.list(
        { limit: 10, offset: 20 } as never,
        'org-1',
        'user-1'
      );

      // The features service signature is `(db, input)` — `db` is undefined
      // here because `@borradh-workspace/database` is mocked as `{}`.
      expect(listMock).toHaveBeenCalledWith(undefined, {
        organizationId: 'org-1',
        userId: 'user-1',
        type: undefined,
        limit: 10,
        offset: 20,
      });
    });

    it('rejects with 400 when no active org is selected', async () => {
      await expect(controller.list({}, '', 'user-1')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(listMock).not.toHaveBeenCalled();
    });

    it('maps INTERNAL_ERROR → 500', async () => {
      listMock.mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: 'db down' },
      });

      let caught: HttpException | undefined;
      try {
        await controller.list({}, 'org-1', 'user-1');
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('edit', () => {
    const baseDto = { content: 'Updated memory content.' };

    it('returns the service payload untouched', async () => {
      // `editMemory` returns `updatedAt` as an ISO string already.
      const payload = {
        knowledgeEntryId: 'mem-1',
        content: baseDto.content,
        updatedAt: '2026-04-26T11:30:00.000Z',
      };
      editMock.mockResolvedValueOnce({ success: true, data: payload });

      const result = await controller.edit('mem-1', baseDto, 'org-1', 'user-1');

      expect(result).toBe(payload);
    });

    it('passes id, org, user through to the service', async () => {
      editMock.mockResolvedValueOnce({
        success: true,
        data: {
          knowledgeEntryId: 'mem-1',
          content: baseDto.content,
          updatedAt: new Date().toISOString(),
        },
      });

      await controller.edit(
        'mem-1',
        baseDto,
        'org-from-session',
        'user-from-session'
      );

      expect(editMock).toHaveBeenCalledWith(undefined, {
        id: 'mem-1',
        organizationId: 'org-from-session',
        userId: 'user-from-session',
        content: baseDto.content,
      });
    });

    it('rejects with 400 when no active org is selected', async () => {
      await expect(
        controller.edit('mem-1', baseDto, '', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(editMock).not.toHaveBeenCalled();
    });

    it('maps NOT_FOUND → 404', async () => {
      editMock.mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.NOT_FOUND, message: 'gone' },
      });

      await expect(
        controller.edit('mem-1', baseDto, 'org-1', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('maps FORBIDDEN → 403 (cross-user / cross-org access)', async () => {
      editMock.mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'no' },
      });

      await expect(
        controller.edit('mem-1', baseDto, 'org-1', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('maps INVALID_INPUT → 400 (hard-block fail)', async () => {
      editMock.mockResolvedValueOnce({
        success: false,
        error: {
          code: ErrorCodes.INVALID_INPUT,
          message: 'pom_brand: "Botox"',
        },
      });

      await expect(
        controller.edit('mem-1', baseDto, 'org-1', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    });
  });

  describe('remove', () => {
    it('returns deleted: true on success', async () => {
      deleteMock.mockResolvedValueOnce({
        success: true,
        data: { deleted: true, knowledgeEntryId: 'mem-1' },
      });

      const result = await controller.remove('mem-1', 'org-1', 'user-1');

      expect(result).toEqual({ deleted: true, knowledgeEntryId: 'mem-1' });
    });

    it('passes id, org, user through to the service', async () => {
      deleteMock.mockResolvedValueOnce({
        success: true,
        data: { deleted: true, knowledgeEntryId: 'mem-1' },
      });

      await controller.remove('mem-1', 'org-from-session', 'user-from-session');

      expect(deleteMock).toHaveBeenCalledWith(undefined, {
        id: 'mem-1',
        organizationId: 'org-from-session',
        userId: 'user-from-session',
      });
    });

    it('rejects with 400 when no active org is selected', async () => {
      await expect(
        controller.remove('mem-1', '', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      expect(deleteMock).not.toHaveBeenCalled();
    });

    it('maps NOT_FOUND → 404', async () => {
      deleteMock.mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.NOT_FOUND, message: 'gone' },
      });

      await expect(
        controller.remove('mem-1', 'org-1', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    });

    it('maps FORBIDDEN → 403', async () => {
      deleteMock.mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.FORBIDDEN, message: 'no' },
      });

      await expect(
        controller.remove('mem-1', 'org-1', 'user-1')
      ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    });

    it('maps unknown error → 500', async () => {
      deleteMock.mockResolvedValueOnce({
        success: false,
        error: { code: 'WEIRD_INTERNAL_DETAIL', message: 'leaks' },
      });

      let caught: HttpException | undefined;
      try {
        await controller.remove('mem-1', 'org-1', 'user-1');
      } catch (e) {
        caught = e as HttpException;
      }
      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });
});
