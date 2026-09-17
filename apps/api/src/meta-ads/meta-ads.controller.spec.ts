// Mock the heavy transitive chain before importing the controller. Same
// barrel-pull pattern as `memories.controller.spec.ts` /
// `uploads.controller.spec.ts`: the features barrels reach ESM-only packages
// (cuid2, env-core) that swc-jest can't transform, and the DTO files call
// `.omit(...)` on the schemas at module-init time, so the schemas need to be
// real zod objects.
// `virtual: true` so jest doesn't require features' `dist/` to exist — sibling
// windows may be mid-build.
jest.mock(
  '@borradh-workspace/features/meta-ads',
  () => {
    const z = require('zod');
    const passthrough = z.object({}).passthrough();
    return {
      acknowledgeMetaAdsWebhook: jest.fn(),
      createAd: jest.fn(),
      deleteAd: jest.fn(),
      duplicateAd: jest.fn(),
      getAd: jest.fn(),
      healthCheck: jest.fn(),
      importMetaAds: jest.fn(),
      launchAdFromPost: jest.fn(),
      launchAndFinalizeAd: jest.fn(),
      listAds: jest.fn(),
      publishAd: jest.fn(),
      replaceAdCreative: jest.fn(),
      syncAdStatus: jest.fn(),
      updateAd: jest.fn(),
      // Schemas the DTO files call `.omit()` on at module-init time.
      createAdSchema: passthrough,
      updateAdSchema: passthrough,
      replaceAdCreativeRequestSchema: passthrough,
      listAdsSchema: passthrough,
      launchAdSchema: passthrough,
      launchAdFromPostSchema: passthrough,
    };
  },
  { virtual: true }
);

jest.mock(
  '@borradh-workspace/features/claire',
  () => ({
    promoteDraftAd: jest.fn(),
  }),
  { virtual: true }
);

// `@borradh-workspace/features/shared` reaches `database/schema` →
// `@paralleldrive/cuid2` (ESM-only). swc-jest can't transform that, so we
// stub the only symbol the controller imports. Same precedent as
// `memories.controller.spec.ts`.
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

jest.mock('@borradh-workspace/database', () => ({}), { virtual: true });

jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

// `../common` re-exports `auth.guard` → `@borradh-workspace/email` →
// `@t3-oss/env-core` (ESM-only). swc-jest can't transform; stub the surface
// the controller decorator-imports. These decorators only need to be
// well-formed (they run at class-DEFINITION time, storing metadata) — never
// instantiated, since this spec never boots a real Nest DI container.
jest.mock('../common', () => ({
  AuthGuard: class {
    canActivate() {
      return true;
    }
  },
  RoleGuard: class {
    canActivate() {
      return true;
    }
  },
  Public: () => () => undefined,
  RequireRole: () => () => undefined,
  ActiveOrganization: () => () => undefined,
}));

jest.mock('../common/decorators/media-urls.decorator.js', () => ({
  MediaUrls: () => () => undefined,
}));

jest.mock('../common/guards/webhooks/hub-challenge.guard.js', () => ({
  HubChallenge: () => () => undefined,
  HubChallengeEcho: () => () => undefined,
}));

jest.mock('../common/interceptors/media-url.interceptor.js', () => ({
  MediaUrlInterceptor: class {},
}));

import { getAd } from '@borradh-workspace/features/meta-ads';
import { ErrorCodes } from '@borradh-workspace/features/shared';
import { HttpException, HttpStatus } from '@nestjs/common';
import { MetaAdsController } from './meta-ads.controller.js';

const getAdMock = getAd as unknown as jest.Mock;

describe('MetaAdsController', () => {
  let controller: MetaAdsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new MetaAdsController();
  });

  describe('mapErrorToHttpException (via findOne)', () => {
    it('maps FORBIDDEN → 403 and preserves message + details (ENG-852)', async () => {
      // This is the ENG-852 regression: Meta's `permission_denied` category
      // classifies to ErrorCodes.FORBIDDEN in handle-meta-error.ts. Left
      // unmapped here it fell to the 500 default, and sanitize-errors.filter
      // scrubs every >=500 body to a generic message in every environment —
      // so Claire (and the regular frontend) never saw why the launch failed.
      getAdMock.mockResolvedValueOnce({
        success: false,
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: "Your Meta connection doesn't have permission to do this.",
          details: {
            metaError: {
              errorKey: 'META_PERMISSION_GENERIC',
              category: 'permission_denied',
            },
          },
        },
      });

      let caught: HttpException | undefined;
      try {
        await controller.findOne('ad-1', 'org-1');
      } catch (e) {
        caught = e as HttpException;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(HttpStatus.FORBIDDEN);
      const response = caught?.getResponse() as {
        message: string;
        code: string;
        details?: Record<string, unknown>;
      };
      expect(response.message).toBe(
        "Your Meta connection doesn't have permission to do this."
      );
      expect(response.code).toBe(ErrorCodes.FORBIDDEN);
      expect(response.details).toEqual({
        metaError: {
          errorKey: 'META_PERMISSION_GENERIC',
          category: 'permission_denied',
        },
      });
    });

    it('maps INTERNAL_ERROR → 500', async () => {
      getAdMock.mockResolvedValueOnce({
        success: false,
        error: { code: ErrorCodes.INTERNAL_ERROR, message: 'db down' },
      });

      let caught: HttpException | undefined;
      try {
        await controller.findOne('ad-1', 'org-1');
      } catch (e) {
        caught = e as HttpException;
      }

      expect(caught).toBeInstanceOf(HttpException);
      expect(caught?.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('rejects with 400 when no active org is selected', async () => {
      await expect(controller.findOne('ad-1', '')).rejects.toMatchObject({
        status: HttpStatus.BAD_REQUEST,
      });
      expect(getAdMock).not.toHaveBeenCalled();
    });
  });
});
