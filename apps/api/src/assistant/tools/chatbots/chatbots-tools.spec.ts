// Mock the heavy transitive chain before importing tools/tool-factory —
// same precedent as `offers-tools.spec.ts` / `hard-blocks.spec.ts`.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
}));

jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

jest.mock('@borradh-workspace/env/api', () => ({
  apiEnv: {},
}));

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  logWarning: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  })),
  trackedResult: <T>(_name: string, fn: () => Promise<T>) => fn(),
}));

import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { setChatbotEnabledTool } from './set-enabled.tool.js';

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
  createConfirmation?: AssistantToolsContext['createConfirmation'];
  verifyConfirmation?: AssistantToolsContext['verifyConfirmation'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    // `chatbots_setEnabled` declares `policy: 'admin'`; the factory fails
    // closed without a resolvable caller role, so the ctx must carry one.
    callerRole: 'admin',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch),
    callCounter: createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation:
      overrides.createConfirmation ??
      (jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })) as never),
    verifyConfirmation:
      overrides.verifyConfirmation ??
      (jest.fn(async () => ({ valid: true, payload: null })) as never),
  } as AssistantToolsContext;
}

const FB_PAGE = {
  id: 'row-1',
  pageId: 'page-123',
  pageName: 'Glow Clinic',
  pageUsername: 'glowclinic',
  pagePictureUrl: null,
  platform: 'facebook' as const,
  pixelId: null,
  pixelName: null,
  defaultLeadFormId: null,
  defaultLeadFormName: null,
  defaultAdAccountId: null,
  defaultAdAccountName: null,
  defaultAdAccountCurrency: null,
  linkedInstagramAccountId: null,
  linkedInstagramUsername: null,
};

const META_INTEGRATION = {
  integration: {
    id: 'int-1',
    configurationStatus: 'configured',
    adAccountId: 'act_1',
    adAccountName: 'Main',
    defaultPageId: 'page-123',
    isActive: true,
    tokenStatus: 'valid',
    connectedByName: null,
    facebookUserName: null,
    facebookUserEmail: null,
    facebookUserPictureUrl: null,
    tokenExpiresAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    pages: [FB_PAGE],
    defaultPage: FB_PAGE,
    availableBusinesses: null,
    availableAdAccounts: null,
    availablePages: null,
  },
};

const WA_ACCOUNT = {
  id: 'wa-1',
  phoneNumberId: 'pn-1',
  phoneNumber: '+353851234567',
  displayName: 'Glow Clinic WA',
  isActive: true,
  isVerified: true,
  isChatbotActive: true,
  connectedByName: null,
  tokenExpiresAt: null,
  tokenStatus: 'valid',
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('chatbots tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('setChatbotEnabledTool', () => {
    it('is a destructive tool named chatbots_setEnabled with the toggle_chatbot action', () => {
      expect(setChatbotEnabledTool.name).toBe('chatbots_setEnabled');
      expect(setChatbotEnabledTool.feature).toBe('chatbots');
      expect(setChatbotEnabledTool.action).toBe('setEnabled');
      expect(setChatbotEnabledTool.destructive).toBe(true);
      expect(setChatbotEnabledTool.destructiveAction).toBe('toggle_chatbot');
    });

    it('rejects invalid channels', async () => {
      const ctx = buildCtx();
      const result = await setChatbotEnabledTool.execute(
        { channel: 'telegram', enabled: false },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('VALIDATION_ERROR');
    });

    // -----------------------------------------------------------------------
    // First call — confirmation required
    // -----------------------------------------------------------------------

    it('instagram: first call returns confirmation_required without any PUT', async () => {
      const apiFetch = jest.fn();
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await setChatbotEnabledTool.execute(
        { channel: 'instagram', enabled: false },
        ctx
      );
      expect(result.ok).toBe(true);
      expect(result.presentation).toMatchObject({
        type: 'confirmation_required',
        action: 'toggle_chatbot',
        token: 'token-abc',
        executeToolName: 'chatbots_setEnabled',
        renderer: 'ChatbotToggleConfirmation',
      });
      const summary = (result.presentation as { summary: { title: string } })
        .summary;
      expect(summary.title).toContain('OFF');
      expect(summary.title).toContain('Instagram');
      // No write happened — instagram needs no lookup either.
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('facebook_messenger: auto-resolves the default page and binds it in the payload', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/meta-ads/integration')
          return META_INTEGRATION;
        throw new Error(`unexpected path ${path}`);
      });
      const createConfirmation = jest.fn(async () => ({
        id: 'token-abc',
        expiresAt: new Date(Date.now() + 30 * 60_000),
      }));
      const ctx = buildCtx({
        apiFetch: apiFetch as never,
        createConfirmation: createConfirmation as never,
      });
      const result = await setChatbotEnabledTool.execute(
        { channel: 'facebook_messenger', enabled: false },
        ctx
      );
      expect(result.ok).toBe(true);
      expect(result.presentation).toMatchObject({
        type: 'confirmation_required',
      });
      expect(createConfirmation).toHaveBeenCalledWith({
        action: 'toggle_chatbot',
        resourceId: 'page-123',
        payload: {
          channel: 'facebook_messenger',
          enabled: false,
          targetId: 'page-123',
        },
      });
    });

    it('whatsapp: fails the confirmation when multiple accounts exist and no targetId given', async () => {
      const apiFetch = jest.fn(async () => ({
        accounts: [WA_ACCOUNT, { ...WA_ACCOUNT, id: 'wa-2' }],
      }));
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await setChatbotEnabledTool.execute(
        { channel: 'whatsapp', enabled: false },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONFIRMATION_SUMMARIZE_FAILED');
    });

    // -----------------------------------------------------------------------
    // Second call — token verified, PUT executed, persisted state reported
    // -----------------------------------------------------------------------

    it('instagram: second call PUTs the toggle and reports the persisted flag', async () => {
      const apiFetch = jest.fn(async (path: string, opts?: unknown) => {
        if (path === 'integrations/instagram/chatbot') {
          expect(opts).toMatchObject({
            method: 'PUT',
            body: { enabled: false },
          });
          return { chatbotEnabled: false };
        }
        throw new Error(`unexpected path ${path}`);
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await setChatbotEnabledTool.execute(
        {
          channel: 'instagram',
          enabled: false,
          confirmationToken: 'token-abc',
        },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual({
          channel: 'instagram',
          targetId: null,
          targetLabel: 'Instagram DMs',
          enabled: false,
        });
      }
    });

    it('whatsapp: second call resolves the single account and PUTs its toggle', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/whatsapp/accounts')
          return { accounts: [WA_ACCOUNT] };
        if (path === 'integrations/whatsapp/wa-1/chatbot')
          return { isChatbotActive: false };
        throw new Error(`unexpected path ${path}`);
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await setChatbotEnabledTool.execute(
        { channel: 'whatsapp', enabled: false, confirmationToken: 'token-abc' },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toMatchObject({
          channel: 'whatsapp',
          targetId: 'wa-1',
          enabled: false,
        });
      }
    });

    it('reports the PERSISTED flag even when it disagrees with the request', async () => {
      // Endpoint says the flag ended up true although we asked for false —
      // the tool must not echo the request (truthful-state rule).
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/instagram/chatbot')
          return { chatbotEnabled: true };
        throw new Error(`unexpected path ${path}`);
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await setChatbotEnabledTool.execute(
        {
          channel: 'instagram',
          enabled: false,
          confirmationToken: 'token-abc',
        },
        ctx
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data?.enabled).toBe(true);
    });

    it('rejects a second call whose direction contradicts the confirmed payload', async () => {
      const verifyConfirmation = jest.fn(async () => ({
        valid: true,
        payload: { channel: 'instagram', enabled: false },
      }));
      const ctx = buildCtx({ verifyConfirmation: verifyConfirmation as never });
      const result = await setChatbotEnabledTool.execute(
        { channel: 'instagram', enabled: true, confirmationToken: 'token-abc' },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONFIRMATION_PAYLOAD_MISMATCH');
    });

    it('rejects an expired/invalid token', async () => {
      const verifyConfirmation = jest.fn(async () => ({
        valid: false,
        reason: 'expired',
      }));
      const ctx = buildCtx({ verifyConfirmation: verifyConfirmation as never });
      const result = await setChatbotEnabledTool.execute(
        { channel: 'instagram', enabled: false, confirmationToken: 'stale' },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('CONFIRMATION_INVALID');
    });

    it('surfaces a friendly error when the integration is missing (404)', async () => {
      const { ApiFetchError } = jest.requireActual<
        typeof import('../../tool-factory/api-fetch.js')
      >('../../tool-factory/api-fetch.js');
      const apiFetch = jest.fn(async () => {
        throw new ApiFetchError('Not found', 404);
      });
      const ctx = buildCtx({ apiFetch: apiFetch as never });
      const result = await setChatbotEnabledTool.execute(
        {
          channel: 'instagram',
          enabled: false,
          confirmationToken: 'token-abc',
        },
        ctx
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toContain('Instagram is not connected');
      }
    });
  });
});
