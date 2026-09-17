import { buildAssistantPorts } from '../../ports/index.js';
import { createLeadFormsPort } from '../../ports/lead-forms.adapter.js';
import { ApiFetchError } from '../../tool-factory/api-fetch.js';
import { createToolCallCounter } from '../../tool-factory/tool-call-limit.js';
import type { AssistantToolsContext } from '../../tool-factory/types.js';
import { createLeadFormTool } from './create-lead-form.tool.js';
import { leadFormsTools } from './index.js';
import { listLeadFormsTool } from './list-lead-forms.tool.js';
import { previewLeadFormTool } from './preview-lead-form.tool.js';
import { updateLeadFormTool } from './update-lead-form.tool.js';

jest.mock('@borradh-workspace/observability', () => ({
  logError: jest.fn(),
  isPostHogInitialized: () => false,
  isSentryInitialized: () => false,
  trackEvent: jest.fn(),
  addBreadcrumb: jest.fn(),
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('@borradh-workspace/database', () => ({ db: {} }));

// The tool-factory's confirmation.ts imports from features/assistant (which
// pulls in the knowledge module). Short-circuit it like the ads spec does.
jest.mock('@borradh-workspace/features/assistant', () => ({
  createConfirmationToken: jest.fn(),
  verifyConfirmationToken: jest.fn(),
  validateGeneratedCopy: jest.fn(() => []),
}));

// getPrimaryLocation drives the country → nurture channel; getOrganization
// supplies the privacy-policy URL. Defaults: UK clinic with a privacy URL.
jest.mock('@borradh-workspace/features/organizations', () => ({
  getPrimaryLocation: jest.fn(async () => ({
    success: true,
    data: {
      id: 'loc_1',
      label: 'Camden, London',
      city: 'London',
      country: 'gb',
      latitude: 51,
      longitude: 0,
    },
  })),
  getOrganization: jest.fn(async () => ({
    success: true,
    data: { id: 'org-1', privacyPolicyUrl: 'https://clinic.example/privacy' },
  })),
  // Default: the org resolves to a usable privacy-policy URL (website / FB page
  // / connected Facebook Page). Individual tests override this to null.
  resolveOrgPrivacyPolicyUrl: jest.fn(
    async () => 'https://clinic.example/privacy'
  ),
}));

import { getPrimaryLocation } from '@borradh-workspace/features/organizations';

function buildCtx(
  apiFetch: AssistantToolsContext['apiFetch']
): AssistantToolsContext {
  return {
    organizationId: 'org-1',
    userId: 'user-1',
    conversationId: 'conv-1',
    apiFetch,
    buildApiFetch: jest.fn(() => apiFetch) as never,
    // Ports are composed over the SAME mocked apiFetch, so every existing
    // assertion about which paths a tool hits still holds — only the shape the
    // tool returns changed. `leadForms` is spliced in here rather than coming
    // from `buildAssistantPorts` because the composition root has not been
    // wired for it yet; drop the spread + cast once it is.
    ports: {
      ...buildAssistantPorts({ apiFetch, conversationId: 'conv-1' }),
      leadForms: createLeadFormsPort({ apiFetch }),
    } as AssistantToolsContext['ports'],
    reportIssue: jest.fn(),
    callCounter: createToolCallCounter(50),
    runHardBlocks: jest.fn(async () => ({ pass: true })) as never,
    createConfirmation: jest.fn() as never,
    verifyConfirmation: jest.fn() as never,
  };
}

/** A connected WhatsApp account with a usable token + a display number. */
const usableWhatsApp = {
  accounts: [
    {
      id: 'wa-1',
      phoneNumber: '+447700900000',
      displayName: 'Clinic',
      isActive: true,
      tokenStatus: 'valid',
    },
  ],
};

describe('lead-forms tools', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('registry', () => {
    it('registers the four lead-form tools with lead_forms_ names', () => {
      expect(leadFormsTools.map((t) => t.name).sort()).toEqual([
        'lead_forms_createLeadForm',
        'lead_forms_listLeadForms',
        'lead_forms_previewLeadForm',
        'lead_forms_updateLeadForm',
      ]);
      // Bare-action aliases the skills reference.
      expect(leadFormsTools.map((t) => t.action).sort()).toEqual([
        'createLeadForm',
        'listLeadForms',
        'previewLeadForm',
        'updateLeadForm',
      ]);
    });
  });

  describe('createLeadFormTool', () => {
    it('creates a synced form with default fields + country-driven WhatsApp channel', async () => {
      const apiFetch = jest.fn(
        async (path: string, opts?: { body?: unknown }) => {
          if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
          if (path === 'lead-forms') {
            return {
              id: 'lf-1',
              name: (opts?.body as { name: string }).name,
              status: 'synced',
              metaFormId: 'meta-1',
              followUpChannel: 'whatsapp',
              whatsappNumber: '+447700900000',
              questions: [
                { type: 'FULL_NAME' },
                { type: 'EMAIL' },
                { type: 'PHONE' },
              ],
            };
          }
          throw new Error(`Unexpected path: ${path}`);
        }
      );

      const result = await createLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.leadFormId).toBe('lf-1');
        expect(result.data.metaFormId).toBe('meta-1');
        expect(result.data.followUpChannel).toBe('whatsapp');
        expect(result.data.syncState).toBe('synced');
      }
      // The banned shape. `{ ready: false, status: 'draft' }` shipped with
      // Claire calling the form live; there is no boolean left to misread.
      expect(JSON.stringify(result)).not.toContain('"ready"');
      // The POST body carried default fields + whatsapp channel + syncToMeta.
      const postCall = apiFetch.mock.calls.find((c) => c[0] === 'lead-forms');
      const body = (postCall?.[1] as { body: Record<string, unknown> }).body;
      expect(body.questions).toEqual([
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
        { type: 'PHONE' },
        {
          type: 'CUSTOM',
          label: 'How soon are you hoping to get this treatment done?',
          key: 'treatment_timing',
          options: [
            { value: 'ASAP', key: 'asap' },
            { value: '1 week', key: '1_week' },
            { value: '2 weeks', key: '2_weeks' },
          ],
        },
      ]);
      expect(body.followUpChannel).toBe('whatsapp');
      expect(body.whatsappNumber).toBe('+447700900000');
      expect(body.syncToMeta).toBe(true);
      expect(body.privacyPolicyUrl).toBe('https://clinic.example/privacy');
    });

    it('respects custom questions', async () => {
      const apiFetch = jest.fn(
        async (path: string, opts?: { body?: unknown }) => {
          if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
          if (path === 'lead-forms')
            return {
              id: 'lf-2',
              name: 'x',
              status: 'synced',
              metaFormId: 'meta-2',
              followUpChannel: 'whatsapp',
              whatsappNumber: '+447700900000',
              questions: (opts?.body as { questions: unknown }).questions,
            };
          throw new Error(`Unexpected path: ${path}`);
        }
      );
      await createLeadFormTool.execute(
        { questions: ['FULL_NAME', 'EMAIL', 'PHONE', 'CITY'] },
        buildCtx(apiFetch as never)
      );
      const body = (
        apiFetch.mock.calls.find((c) => c[0] === 'lead-forms')?.[1] as {
          body: Record<string, unknown>;
        }
      ).body;
      expect(body.questions).toEqual([
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
        { type: 'PHONE' },
        { type: 'CITY' },
      ]);
    });

    it('returns a not-ready card when the org has no privacy-policy URL', async () => {
      const {
        resolveOrgPrivacyPolicyUrl,
      } = require('@borradh-workspace/features/organizations');
      (resolveOrgPrivacyPolicyUrl as jest.Mock).mockResolvedValueOnce(null);
      const apiFetch = jest.fn(async () => {
        throw new Error('should not POST');
      });
      const result = await createLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('no_form');
        expect(result.data.statusMessage).toMatch(/privacy-policy/);
      }
      expect(apiFetch).not.toHaveBeenCalled();
    });

    it('reports not_synced — with the reason the response hid — when the Meta sync fails', async () => {
      // The defect, end to end. `createLeadForm` returns the row it captured
      // BEFORE syncing (status 'draft', syncError null) while the sync service
      // has already written status 'error' + the reason. The old tool read
      // `form.syncError` off that stale body, so its `reason` was ALWAYS
      // undefined and Claire had nothing but `ready: false` to go on.
      const apiFetch = jest.fn(async (path: string, opts?: unknown) => {
        if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
        if (path === 'lead-forms' && opts) {
          return {
            id: 'lf-9',
            name: 'x',
            status: 'draft',
            metaFormId: null,
            followUpChannel: 'whatsapp',
            whatsappNumber: '+447700900000',
            questions: [{ type: 'EMAIL' }],
            syncError: null,
          };
        }
        if (path === 'lead-forms/lf-9') {
          return {
            id: 'lf-9',
            name: 'x',
            status: 'error',
            metaFormId: null,
            followUpChannel: 'whatsapp',
            whatsappNumber: '+447700900000',
            questions: [{ type: 'EMAIL' }],
            syncError: 'Meta Ads integration not configured or inactive',
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = await createLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('not_synced');
        expect(result.data.metaFormId).toBeUndefined();
        // The owner is told the form cannot collect leads, AND why.
        expect(result.data.statusMessage).toMatch(/cannot collect any leads/i);
        expect(result.data.statusMessage).toMatch(
          /Meta Ads account isn't connected/i
        );
        expect(result.data.title).toMatch(/NOT live on Meta/);
      }
    });

    it('does NOT claim live-on-Meta when the Meta token is expired', async () => {
      // Browser-tested false-success: creating a lead-form campaign printed
      // "Lead form live on Meta / Status: Live on Meta" despite an EXPIRED Meta
      // token. The local write succeeds (draft), the Meta sync throws code 190,
      // and the authoritative read-back is `error` carrying the raw OAuth
      // message. The card must report the honest failure (reconnect Meta) and
      // must NOT say the form is live.
      const apiFetch = jest.fn(async (path: string, opts?: unknown) => {
        if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
        if (path === 'lead-forms' && opts) {
          return {
            id: 'lf-190',
            name: 'x',
            status: 'draft',
            metaFormId: null,
            followUpChannel: 'whatsapp',
            whatsappNumber: '+447700900000',
            questions: [{ type: 'EMAIL' }],
            syncError: null,
          };
        }
        if (path === 'lead-forms/lf-190') {
          return {
            id: 'lf-190',
            name: 'x',
            status: 'error',
            metaFormId: null,
            followUpChannel: 'whatsapp',
            whatsappNumber: '+447700900000',
            questions: [{ type: 'EMAIL' }],
            syncError:
              'Meta API Error: Error validating access token: Session has expired. (code: 190)',
          };
        }
        throw new Error(`Unexpected path: ${path}`);
      });

      const result = await createLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('not_synced');
        expect(result.data.metaFormId).toBeUndefined();
        // The two strings the browser saw — neither may appear as a claim.
        expect(result.data.title).toBe('Lead form saved — NOT live on Meta');
        expect(result.data.title).not.toBe('Lead form live on Meta');
        // Honest, actionable cause: reconnect Meta — not "Meta rejected the form".
        expect(result.data.statusMessage).toMatch(
          /Meta connection has expired/i
        );
        expect(result.data.statusMessage).toMatch(/Reconnect Meta/i);
        expect(result.data.statusMessage).not.toMatch(
          /Meta rejected the form/i
        );
      }
    });

    it('says sync_unconfirmed rather than claiming success when the read-back fails', async () => {
      const apiFetch = jest.fn(async (path: string, opts?: unknown) => {
        if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
        if (path === 'lead-forms' && opts) {
          return {
            id: 'lf-8',
            name: 'x',
            status: 'draft',
            metaFormId: null,
            followUpChannel: 'whatsapp',
            whatsappNumber: null,
            questions: [{ type: 'EMAIL' }],
          };
        }
        throw new Error('read timed out');
      });

      const result = await createLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('sync_unconfirmed');
        expect(result.data.leadFormId).toBe('lf-8');
      }
    });

    it('returns no_form and reports nothing to Sentry when the API refuses (4xx)', async () => {
      // API-9G / ENG-402: a stated 4xx refusal must not page anyone.
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
        throw new ApiFetchError(
          'Lead form with name "Consult form" already exists',
          409
        );
      });
      const ctx = buildCtx(apiFetch as never);
      const result = await createLeadFormTool.execute({}, ctx);

      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('no_form');
        expect(result.data.statusMessage).toMatch(/already have a lead form/i);
      }
      expect(ctx.reportIssue).not.toHaveBeenCalled();
    });

    it('uses Messenger for a US org even with WhatsApp connected', async () => {
      (getPrimaryLocation as jest.Mock).mockResolvedValueOnce({
        success: true,
        data: {
          id: 'loc_us',
          label: 'Austin',
          city: 'Austin',
          country: 'us',
          latitude: 30,
          longitude: -97,
        },
      });
      const apiFetch = jest.fn(
        async (path: string, opts?: { body?: unknown }) => {
          if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
          if (path === 'lead-forms')
            return {
              id: 'lf-3',
              name: 'x',
              status: 'synced',
              metaFormId: 'meta-3',
              followUpChannel: (opts?.body as { followUpChannel: string })
                .followUpChannel,
              whatsappNumber: null,
              questions: [],
            };
          throw new Error(`Unexpected: ${path}`);
        }
      );
      const result = await createLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data)
        expect(result.data.followUpChannel).toBe('messenger');
      const body = (
        apiFetch.mock.calls.find((c) => c[0] === 'lead-forms')?.[1] as {
          body: Record<string, unknown>;
        }
      ).body;
      expect(body.followUpChannel).toBe('messenger');
      expect(body.whatsappNumber).toBeNull();
    });
  });

  describe('updateLeadFormTool', () => {
    it('merges addFields onto the current questions and flags a relink on a re-synced live form', async () => {
      const apiFetch = jest.fn(
        async (path: string, opts?: { method?: string; body?: unknown }) => {
          if (path === 'lead-forms/lf-1' && (!opts || opts.method !== 'PUT')) {
            return {
              id: 'lf-1',
              name: 'My form',
              status: 'synced',
              metaFormId: 'old-meta',
              followUpChannel: 'whatsapp',
              whatsappNumber: '+447700900000',
              questions: [{ type: 'FULL_NAME' }, { type: 'EMAIL' }],
            };
          }
          if (path === 'lead-forms/lf-1' && opts?.method === 'PUT') {
            return {
              id: 'lf-1',
              name: 'My form',
              status: 'synced',
              metaFormId: 'new-meta',
              followUpChannel: 'whatsapp',
              whatsappNumber: '+447700900000',
              questions: (opts.body as { questions: unknown }).questions,
            };
          }
          throw new Error(`Unexpected: ${path}`);
        }
      );

      const result = await updateLeadFormTool.execute(
        { leadFormId: 'lf-1', addFields: ['PHONE'] },
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // Both ids are on the output, so "the live campaign still serves the
        // old form" is checkable rather than asserted by a boolean.
        expect(result.data.previousMetaFormId).toBe('old-meta');
        expect(result.data.metaFormId).toBe('new-meta');
        expect(result.data.syncState).toBe('synced');
        expect(result.data.statusMessage).toMatch(/OLD version/);
      }
      const putCall = apiFetch.mock.calls.find(
        (c) =>
          c[0] === 'lead-forms/lf-1' &&
          (c[1] as { method?: string })?.method === 'PUT'
      );
      const body = (putCall?.[1] as { body: Record<string, unknown> }).body;
      expect(body.questions).toEqual([
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
        { type: 'PHONE' },
      ]);
      expect(body.syncToMeta).toBe(true);
    });

    it('removes a field', async () => {
      const apiFetch = jest.fn(
        async (path: string, opts?: { method?: string; body?: unknown }) => {
          if (path === 'lead-forms/lf-1' && opts?.method !== 'PUT')
            return {
              id: 'lf-1',
              name: 'f',
              status: 'draft',
              metaFormId: null,
              followUpChannel: 'messenger',
              whatsappNumber: null,
              questions: [
                { type: 'FULL_NAME' },
                { type: 'EMAIL' },
                { type: 'COMPANY_NAME' },
              ],
            };
          return {
            id: 'lf-1',
            name: 'f',
            status: 'draft',
            metaFormId: null,
            followUpChannel: 'messenger',
            whatsappNumber: null,
            questions: (opts?.body as { questions: unknown }).questions,
          };
        }
      );
      await updateLeadFormTool.execute(
        { leadFormId: 'lf-1', removeFields: ['COMPANY_NAME'] },
        buildCtx(apiFetch as never)
      );
      const body = (
        apiFetch.mock.calls.find(
          (c) => (c[1] as { method?: string })?.method === 'PUT'
        )?.[1] as { body: Record<string, unknown> }
      ).body;
      expect(body.questions).toEqual([
        { type: 'FULL_NAME' },
        { type: 'EMAIL' },
      ]);
    });

    it('refuses to remove the last field', async () => {
      const apiFetch = jest.fn(async () => ({
        id: 'lf-1',
        name: 'f',
        status: 'draft',
        metaFormId: null,
        followUpChannel: 'messenger',
        whatsappNumber: null,
        questions: [{ type: 'EMAIL' }],
      }));
      const result = await updateLeadFormTool.execute(
        { leadFormId: 'lf-1', removeFields: ['EMAIL'] },
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('no_form');
      }
    });

    it('keeps the still-live old form visible when the re-sync fails', async () => {
      // The dangerous case: the edit is saved, the NEW version is not on Meta,
      // and the OLD form is still out there collecting leads on the old
      // fields. The stale PUT body carried the old metaFormId and status
      // 'draft', so the previous code reported "updated (re-syncing)" with no
      // reason and no relink flag.
      let written = false;
      const apiFetch = jest.fn(
        async (path: string, opts?: { method?: string; body?: unknown }) => {
          if (path !== 'lead-forms/lf-1')
            throw new Error(`Unexpected: ${path}`);
          if (opts?.method === 'PUT') {
            written = true;
            return {
              id: 'lf-1',
              name: 'My form',
              status: 'draft',
              metaFormId: 'old-meta',
              followUpChannel: 'whatsapp',
              whatsappNumber: null,
              questions: (opts.body as { questions: unknown }).questions,
            };
          }
          // Pre-read, then the authoritative read-back after the PUT.
          return written
            ? {
                id: 'lf-1',
                name: 'My form',
                status: 'error',
                metaFormId: 'old-meta',
                followUpChannel: 'whatsapp',
                whatsappNumber: null,
                questions: [{ type: 'FULL_NAME' }],
                syncError: '(#100) Invalid parameter',
              }
            : {
                id: 'lf-1',
                name: 'My form',
                status: 'synced',
                metaFormId: 'old-meta',
                followUpChannel: 'whatsapp',
                whatsappNumber: null,
                questions: [{ type: 'FULL_NAME' }],
              };
        }
      );

      const result = await updateLeadFormTool.execute(
        { leadFormId: 'lf-1', addFields: ['PHONE'] },
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.syncState).toBe('not_synced');
        expect(result.data.statusMessage).toMatch(/never reached Meta/);
        expect(result.data.statusMessage).toMatch(/Meta rejected the form/);
        expect(result.data.statusMessage).toMatch(
          /previous version is still live/
        );
      }
    });
  });

  describe('previewLeadFormTool', () => {
    it('previews an existing form by id', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'lead-forms/lf-1')
          return {
            id: 'lf-1',
            name: 'Consult form',
            status: 'synced',
            metaFormId: 'm1',
            followUpChannel: 'whatsapp',
            whatsappNumber: '+447700900000',
            questions: [{ type: 'FULL_NAME' }, { type: 'PHONE' }],
          };
        throw new Error(`Unexpected: ${path}`);
      });
      const result = await previewLeadFormTool.execute(
        { leadFormId: 'lf-1' },
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.title).toBe('Consult form');
        expect(result.data.followUpChannel).toBe('whatsapp');
        expect(result.data.questions?.map((q) => q.type)).toEqual([
          'FULL_NAME',
          'PHONE',
        ]);
      }
    });

    it('previews a proposed form with the resolved channel', async () => {
      const apiFetch = jest.fn(async (path: string) => {
        if (path === 'integrations/whatsapp/accounts') return usableWhatsApp;
        throw new Error(`Unexpected: ${path}`);
      });
      const result = await previewLeadFormTool.execute(
        {},
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        // gb + connected whatsapp → whatsapp
        expect(result.data.followUpChannel).toBe('whatsapp');
        expect(result.data.questions?.map((q) => q.type)).toEqual([
          'FULL_NAME',
          'EMAIL',
          'PHONE',
          'CUSTOM',
        ]);
      }
    });
  });

  describe('listLeadFormsTool', () => {
    it('summarises forms from the list endpoint', async () => {
      const apiFetch = jest.fn(async () => ({
        items: [
          {
            id: 'lf-1',
            name: 'A',
            status: 'synced',
            metaFormId: 'm1',
            followUpChannel: 'whatsapp',
            questions: [{ type: 'EMAIL' }, { type: 'PHONE' }],
          },
        ],
      }));
      const result = await listLeadFormsTool.execute(
        { status: 'synced' },
        buildCtx(apiFetch as never)
      );
      expect(result.ok).toBe(true);
      if (result.ok && result.data) {
        expect(result.data.count).toBe(1);
        expect(result.data.leadForms[0]).toMatchObject({
          leadFormId: 'lf-1',
          status: 'synced',
          fieldCount: 2,
        });
      }
      expect((apiFetch.mock.calls[0] as unknown[])[0]).toBe(
        'lead-forms?status=synced'
      );
    });
  });
});
