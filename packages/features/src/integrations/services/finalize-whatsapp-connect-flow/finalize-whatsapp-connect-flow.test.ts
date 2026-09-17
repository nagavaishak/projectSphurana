import { trackOrgEvent } from '@borradh-workspace/observability';
import {
  afterEach,
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';
import * as syncModule from '../../../campaigns/services/sync-whatsapp-templates/sync-whatsapp-templates.service.js';
import { ErrorCodes } from '../../../shared/index.js';
import * as finalizeModule from '../finalize-whatsapp-connection/finalize-whatsapp-connection.service.js';
import { finalizeWhatsappConnectFlow } from './finalize-whatsapp-connect-flow.service.js';

// INTERNAL modules with their own suites — restored `vi.spyOn`, never `vi.mock`.
let mockFinalize: ReturnType<typeof vi.spyOn>;
let mockSync: ReturnType<typeof vi.spyOn>;

const INPUT = {
  organizationId: 'org-1',
  connectedById: 'user-1',
  wabaId: 'waba-1',
  code: 'code-1',
};

describe('finalizeWhatsappConnectFlow', () => {
  const mockDb = createMockDatabase();

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
    mockFinalize = vi.spyOn(finalizeModule, 'finalizeWhatsAppConnection');
    mockSync = vi.spyOn(syncModule, 'syncWhatsappTemplates');
    mockFinalize.mockResolvedValue({
      success: true,
      data: { accounts: [] },
    } as never);
    mockSync.mockResolvedValue({ success: true, data: {} } as never);
  });

  afterEach(() => {
    mockFinalize.mockRestore();
    mockSync.mockRestore();
  });

  it('tracks success and seeds the template cache', async () => {
    const result = await finalizeWhatsappConnectFlow(mockDb as never, INPUT);

    expect(result.success).toBe(true);
    expect(vi.mocked(trackOrgEvent)).toHaveBeenCalledWith(
      'org-1',
      'integrations.whatsapp_connect.callback',
      { status: 'success' }
    );
    expect(mockSync).toHaveBeenCalledWith(mockDb, {
      organizationId: 'org-1',
      refresh: true,
    });
  });

  // Seeding the cache is a convenience. Failing a connect that already
  // succeeded because of it would be strictly worse than an empty cache.
  it('still succeeds when the template sync fails', async () => {
    mockSync.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.INTERNAL_ERROR, message: 'Meta down' },
    } as never);

    const result = await finalizeWhatsappConnectFlow(mockDb as never, INPUT);

    expect(result.success).toBe(true);
  });

  it('tracks the failure with its code and skips the sync', async () => {
    mockFinalize.mockResolvedValue({
      success: false,
      error: { code: ErrorCodes.VALIDATION_ERROR, message: 'Bad code' },
    } as never);

    const result = await finalizeWhatsappConnectFlow(mockDb as never, INPUT);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.message).toBe('Bad code');
    expect(vi.mocked(trackOrgEvent)).toHaveBeenCalledWith(
      'org-1',
      'integrations.whatsapp_connect.callback',
      { status: 'connect_failed', errorCode: ErrorCodes.VALIDATION_ERROR }
    );
    expect(mockSync).not.toHaveBeenCalled();
  });
});
