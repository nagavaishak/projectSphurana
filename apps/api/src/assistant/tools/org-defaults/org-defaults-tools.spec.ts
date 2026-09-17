// Coverage for setOrgDefaultTool. Same heavy-barrel mocking precedent as the
// ads / remember specs — the features/database barrels pull cuid2 + t3-env
// (ESM-only) which swc-jest doesn't transform, and the factory's
// confirmation.ts is the only thing that imports `db`.
jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
}));
jest.mock('@borradh-workspace/database', () => ({ db: {} }));
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { orgDefaultsTools, setOrgDefaultTool } from './index.js';

interface CtxOverrides {
  apiFetch?: AssistantToolsContext['apiFetch'];
}

function buildCtx(overrides: CtxOverrides = {}): AssistantToolsContext {
  const apiFetch = overrides.apiFetch ?? (jest.fn() as never);
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch) as never,
    callCounter: createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation: jest.fn() as never,
    verifyConfirmation: jest.fn() as never,
  };
}

describe('org-defaults tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('registry', () => {
    it('exports a single setOrgDefault tool', () => {
      expect(orgDefaultsTools).toHaveLength(1);
      expect(orgDefaultsTools[0]).toBe(setOrgDefaultTool);
    });

    it('is non-destructive and uses the org_defaults_ factory name', () => {
      expect(setOrgDefaultTool.name).toBe('org_defaults_setOrgDefault');
      expect(setOrgDefaultTool.feature).toBe('org-defaults');
      expect(setOrgDefaultTool.action).toBe('setOrgDefault');
      expect(setOrgDefaultTool.destructive).toBe(false);
    });
  });

  describe('setOrgDefaultTool', () => {
    it('PATCHes org-defaults with the key/value and echoes the persisted value', async () => {
      // Path-aware: the PATCH echoes org-defaults; the budget summary now
      // derives its currency symbol from the connected ad account (GBP here).
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/meta-ads/integration') {
          return {
            integration: {
              defaultPageId: 'p1',
              pages: [
                { id: 'p1', isActive: true, defaultAdAccountCurrency: 'GBP' },
              ],
            },
          };
        }
        return {
          organizationId: 'org-1',
          adDailyBudgetCents: 2000,
          adObjective: 'OUTCOME_LEADS',
          videoOrientation: 'landscape',
          videoLengthSecs: 60,
          brandVoice: null,
          defaultServiceIdForAds: null,
        };
      });
      const result = await setOrgDefaultTool.execute(
        { key: 'adDailyBudgetCents', value: 2000 },
        buildCtx({ apiFetch: apiFetch as never })
      );

      const [calledPath, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { method?: string; body?: Record<string, unknown> },
      ];
      expect(calledPath).toBe('org-defaults');
      expect(calledOpts.method).toBe('PATCH');
      expect(calledOpts.body).toEqual({ adDailyBudgetCents: 2000 });

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.key).toBe('adDailyBudgetCents');
        expect(result.data.value).toBe(2000);
        // £20.00/day derived from 2000 cents in the ad-account currency.
        expect(result.data.summary).toContain('£20.00/day');
      }
    });

    it('clears an override when value is null and reports the system-default fallback', async () => {
      const apiFetch = jest.fn(async () => ({
        organizationId: 'org-1',
        adDailyBudgetCents: 1500,
        adObjective: 'OUTCOME_LEADS',
        videoOrientation: 'landscape',
        videoLengthSecs: 60,
        brandVoice: null,
        defaultServiceIdForAds: null,
      }));
      const result = await setOrgDefaultTool.execute(
        { key: 'brandVoice', value: null },
        buildCtx({ apiFetch: apiFetch as never })
      );

      const [, calledOpts] = apiFetch.mock.calls[0] as [
        string,
        { body?: Record<string, unknown> },
      ];
      expect(calledOpts.body).toEqual({ brandVoice: null });
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.value).toBeNull();
        expect(result.data.summary).toContain('system default');
      }
    });

    it('rejects an unknown key via Zod (no apiFetch)', async () => {
      const apiFetch = jest.fn();
      const result = await setOrgDefaultTool.execute(
        { key: 'notAKey' as never, value: 1 },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('rejects a non-integer budget via the superRefine guard', async () => {
      const apiFetch = jest.fn();
      const result = await setOrgDefaultTool.execute(
        { key: 'adDailyBudgetCents', value: -5 },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('rejects an out-of-enum adObjective via the superRefine guard', async () => {
      const apiFetch = jest.fn();
      const result = await setOrgDefaultTool.execute(
        { key: 'adObjective', value: 'OUTCOME_NONSENSE' },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('VALIDATION_ERROR');
      }
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('soft-errors (factory sanitizes) when the PATCH throws', async () => {
      const apiFetch = jest.fn(async () => {
        throw new Error('org-defaults service down');
      });
      const result = await setOrgDefaultTool.execute(
        { key: 'videoLengthSecs', value: 30 },
        buildCtx({ apiFetch: apiFetch as never })
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('TOOL_EXECUTION_ERROR');
      }
    });
  });
});
