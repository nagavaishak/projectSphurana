import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { vi } from 'vitest';

// Mock the two sibling services (each pulls in the database barrel which is
// undefined under vitest's source resolution); drive them with vi.fn().
const findOrCreateMock = vi.fn();
const saveMessagesMock = vi.fn();

let sendClaireNudge: typeof import('./send-nudge.service.js').sendClaireNudge;
let renderTemplateBody: typeof import(
  './send-nudge.service.js'
).renderTemplateBody;

describe('sendClaireNudge', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    vi.doMock(
      '../services/find-or-create-whatsapp-conversation/index.js',
      () => ({
        findOrCreateWhatsappConversation: (
          ...args: Parameters<typeof findOrCreateMock>
        ) => findOrCreateMock(...args),
      })
    );
    vi.doMock('../services/save-messages/index.js', () => ({
      saveMessages: (...args: Parameters<typeof saveMessagesMock>) =>
        saveMessagesMock(...args),
    }));

    ({ sendClaireNudge, renderTemplateBody } = await import(
      './send-nudge.service.js'
    ));

    findOrCreateMock.mockResolvedValue({
      success: true,
      data: {
        id: 'conv-wa-1',
        loadedSkillIds: [],
        pendingConfirmation: null,
        isNew: false,
      },
    });
    saveMessagesMock.mockResolvedValue({
      success: true,
      data: { success: true },
    });
  });

  afterEach(() => {
    vi.doUnmock('../services/find-or-create-whatsapp-conversation/index.js');
    vi.doUnmock('../services/save-messages/index.js');
    vi.resetModules();
  });

  it('renders the template body with positional params', () => {
    expect(renderTemplateBody('daily_lead_recap', ['7'])).toContain('7');
    expect(
      renderTemplateBody('campaign_milestone', ['Facials', '50 leads'])
    ).toContain('Facials');
  });

  it('sends the approved template AND records an assistant turn', async () => {
    const sendTemplateMessage = vi.fn(async () => ({
      messageId: 'wamid.1',
      success: true,
    }));
    const db = {} as never;

    const result = await sendClaireNudge(
      db,
      { sendTemplateMessage },
      {
        organizationId: 'org-1',
        userId: 'user-1',
        phoneE164: '353871234567',
        template: 'daily_lead_recap',
        params: ['5'],
      }
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        conversationId: 'conv-wa-1',
        messageId: 'wamid.1',
      });
    }

    // The template went out to the owner's number.
    expect(sendTemplateMessage).toHaveBeenCalledTimes(1);
    const sent = sendTemplateMessage.mock.calls[0][0];
    expect(sent.to).toBe('353871234567');
    expect(sent.templateName).toBe('daily_lead_recap');
    expect(sent.parameters).toEqual({ '0': '5' });

    // An assistant turn was recorded so the owner's reply flows into WS-10.
    expect(saveMessagesMock).toHaveBeenCalledTimes(1);
    const saved = saveMessagesMock.mock.calls[0][1];
    expect(saved.conversationId).toBe('conv-wa-1');
    expect(saved.userMessageContent).toBe('');
    expect(saved.assistantText).toContain('5');
  });

  it('returns an error and does NOT record a turn when the template send fails', async () => {
    const sendTemplateMessage = vi.fn(async () => {
      throw new Error('Meta rejected (template not approved)');
    });

    const result = await sendClaireNudge(
      {} as never,
      { sendTemplateMessage },
      {
        organizationId: 'org-1',
        userId: 'user-1',
        phoneE164: '353871234567',
        template: 'no_leads_check_in',
        params: ['Spring Facials'],
      }
    );

    expect(result.success).toBe(false);
    expect(saveMessagesMock).not.toHaveBeenCalled();
  });
});
