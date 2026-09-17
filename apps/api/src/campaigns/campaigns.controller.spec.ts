// The campaigns barrel and its DTOs reach ESM-only packages (cuid2, env-core)
// that swc-jest can't transform, so the heavy chain is stubbed before the
// controller is imported. Same barrel-pull pattern as
// `memories.controller.spec.ts`. `virtual: true` so jest doesn't require
// features' `dist/` to exist — sibling windows may be mid-build.
jest.mock(
  '@borradh-workspace/features/campaigns',
  () => {
    const z = require('zod');
    const passthrough = z.object({}).passthrough();
    return {
      // Only the service this spec drives needs to behave; the rest exist so
      // the controller's import list resolves.
      syncWhatsappTemplates: jest.fn(),
      cancelCampaign: jest.fn(),
      checkChannelEntitlement: jest.fn(),
      createCampaign: jest.fn(),
      createSegment: jest.fn(),
      deleteCampaign: jest.fn(),
      deleteSegment: jest.fn(),
      draftCampaignContent: jest.fn(),
      enqueueCampaignSend: jest.fn(),
      ensureCampaignWhatsappTemplate: jest.fn(),
      getCampaign: jest.fn(),
      getCampaignAnalytics: jest.fn(),
      getSegment: jest.fn(),
      getSmsNumber: jest.fn(),
      launchCampaign: jest.fn(),
      listCampaignRecipients: jest.fn(),
      listCampaigns: jest.fn(),
      listSampleRecipients: jest.fn(),
      listSegments: jest.fn(),
      listSuppressions: jest.fn(),
      previewSegment: jest.fn(),
      provisionSmsNumber: jest.fn(),
      resumeCampaign: jest.fn(),
      searchSmsNumbers: jest.fn(),
      streamCampaignDraft: jest.fn(),
      updateCampaign: jest.fn(),
      updateSegment: jest.fn(),
      upsertCampaignMessage: jest.fn(),
      // Schemas the DTO files call `.omit()`/`.partial()` on at module init.
      draftCampaignContentSchema: passthrough,
      listCampaignsSchema: passthrough,
      listSampleRecipientsSchema: passthrough,
      listSegmentsSchema: passthrough,
      listSuppressionsSchema: passthrough,
      provisionSmsNumberSchema: passthrough,
      searchSmsNumbersSchema: passthrough,
    };
  },
  { virtual: true }
);

jest.mock(
  '@borradh-workspace/contracts',
  () => {
    const z = require('zod');
    const passthrough = z.object({}).passthrough();
    return {
      createCampaignRequestSchema: passthrough,
      updateCampaignRequestSchema: passthrough,
      createSegmentRequestSchema: passthrough,
      updateSegmentRequestSchema: passthrough,
      previewSegmentRequestSchema: passthrough,
      upsertCampaignMessageRequestSchema: passthrough,
    };
  },
  { virtual: true }
);

jest.mock('@borradh-workspace/database', () => ({ db: {} }), { virtual: true });

jest.mock('@borradh-workspace/env/api', () => ({ apiEnv: {} }), {
  virtual: true,
});

jest.mock(
  '@borradh-workspace/integrations/sms',
  () => ({ TwilioSMSService: class {} }),
  { virtual: true }
);

jest.mock(
  '@borradh-workspace/observability',
  () => ({
    logError: jest.fn(),
    trackedResult: <T>(_name: string, fn: () => Promise<T>) => fn(),
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    })),
  }),
  { virtual: true }
);

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
      INTERNAL_ERROR: 'INTERNAL_ERROR',
    },
  }),
  { virtual: true }
);

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
  ActiveOrganization: () => () => undefined,
  CurrentUser: () => () => undefined,
}));

import { syncWhatsappTemplates } from '@borradh-workspace/features/campaigns';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller.js';

const syncMock = syncWhatsappTemplates as unknown as jest.Mock;

describe('CampaignsController — Meta error → HTTP status mapping', () => {
  let controller: CampaignsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new CampaignsController();
  });

  /**
   * `GET /campaigns/whatsapp-templates` is the route that normalizes Meta
   * Graph failures (see `syncWhatsappTemplates`). Every code the registry can
   * produce must land on an actionable 4xx — a 500 here is a Sentry event and
   * a dead end for the client, and a 401 would log the user out of Borradh
   * over an expired *Meta* token.
   */
  const CASES: ReadonlyArray<[string, HttpStatus]> = [
    ['META_AUTH_EXPIRED', HttpStatus.CONFLICT],
    ['META_USER_ACTION_REQUIRED', HttpStatus.PRECONDITION_FAILED],
    ['META_PAYMENT_METHOD_REQUIRED', HttpStatus.PAYMENT_REQUIRED],
    ['META_RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS],
    ['META_ACCOUNT_RESTRICTED', HttpStatus.UNPROCESSABLE_ENTITY],
  ];

  it.each(CASES)('maps %s to %i', async (code, status) => {
    syncMock.mockResolvedValueOnce({
      success: false,
      error: { code, message: `boom: ${code}` },
    });

    await expect(
      controller.whatsappTemplates('org-1', 'true')
    ).rejects.toMatchObject({
      status,
      message: `boom: ${code}`,
    });
  });

  it('never maps a Meta failure to 401 or 500', async () => {
    for (const [code] of CASES) {
      syncMock.mockResolvedValueOnce({
        success: false,
        error: { code, message: 'boom' },
      });
      const thrown = await controller.whatsappTemplates('org-1', 'true').then(
        () => null,
        (e: HttpException) => e
      );
      expect(thrown).toBeInstanceOf(HttpException);
      expect(thrown?.getStatus()).not.toBe(HttpStatus.UNAUTHORIZED);
      expect(thrown?.getStatus()).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    }
  });

  it('still falls through to 500 for an unclassified failure', async () => {
    syncMock.mockResolvedValueOnce({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Failed to sync' },
    });

    await expect(
      controller.whatsappTemplates('org-1', 'true')
    ).rejects.toMatchObject({ status: HttpStatus.INTERNAL_SERVER_ERROR });
  });

  it('returns the payload untouched on success', async () => {
    const payload = { templates: [], synced: true };
    syncMock.mockResolvedValueOnce({ success: true, data: payload });

    await expect(controller.whatsappTemplates('org-1', 'true')).resolves.toBe(
      payload
    );
    expect(syncMock).toHaveBeenCalledWith(
      {},
      { organizationId: 'org-1', refresh: true }
    );
  });
});
