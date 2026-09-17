import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

// Restored spy, never vi.mock — this suite runs isolate:false and a file-local
// vi.mock would replace the chatbots barrel for every later test file.
import { decryptCredentials } from '@borradh-workspace/integrations/encryption';

import { mockWhatsAppCloudService } from '../../../__mocks__/integrations-whatsapp.js';
import * as chatbots from '../../../chatbots/index.js';
import {
  conversationKey,
  sendLeadFirstTouch,
} from './send-lead-first-touch.service.js';

const created = { id: 'conv-1', status: 'bot_handling' };

const mockDb = {
  query: {
    lead: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    conversation: { findFirst: vi.fn() },
    leadForm: { findFirst: vi.fn() },
    organizationService: { findFirst: vi.fn() },
    suppression: { findMany: vi.fn() },
    whatsappAccount: { findFirst: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
    orgSmsNumber: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockReturnThis(),
  returning: vi.fn(),
};

const input = { organizationId: 'org-1', leadId: 'lead-1' };

/**
 * "No conversation was opened."
 *
 * `expect(mockDb.insert).not.toHaveBeenCalled()` used to express this, but a
 * skipped first touch now deliberately writes ONE row — the audit trail that
 * makes "why did this clinic send nothing?" answerable in SQL. So the check has
 * to name the thing it actually cares about. A conversation insert always
 * carries `platform`; the audit row never does.
 */
const expectNoConversationOpened = () => {
  expect(mockDb.values).not.toHaveBeenCalledWith(
    expect.objectContaining({ platform: expect.anything() })
  );
};

/**
 * Shaped exactly as the Meta lead-form webhook writes a lead: `phone` set from
 * the form's `phone_number` field, `whatsapp` null (that column is only filled
 * in when a lead messages us on WhatsApp first). Seeding `whatsapp` here is
 * what hid WhatsApp being ineligible for every real lead-form lead.
 */
const reachableLead = {
  id: 'lead-1',
  firstName: 'Sarah',
  lastName: 'Byrne',
  email: 'sarah@example.com',
  phone: '+353859999999',
  whatsapp: null,
  consentEmail: true,
  consentSms: true,
};

describe('sendLeadFirstTouch', () => {
  let deliverSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    deliverSpy = vi
      .spyOn(chatbots, 'deliverMessages')
      .mockResolvedValue({ attempted: 1, delivered: 1, failed: 0 });
    mockDb.query.lead.findFirst.mockResolvedValue(reachableLead);
    mockDb.query.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Bloom Clinic',
    });
    mockDb.query.conversation.findFirst.mockResolvedValue(undefined);
    mockDb.query.leadForm.findFirst.mockResolvedValue(undefined);
    mockDb.query.organizationService.findFirst.mockResolvedValue(undefined);
    mockDb.query.suppression.findMany.mockResolvedValue([]);
    mockDb.query.whatsappAccount.findFirst.mockResolvedValue(undefined);
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValue(undefined);
    // Claire answers on SMS by default here, so the existing cases keep
    // testing channel choice rather than the chatbot gate.
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue({
      isChatbotActive: true,
    });
    mockDb.returning.mockResolvedValue([created]);
  });

  afterEach(() => {
    deliverSpy.mockRestore();
  });

  const connectedWhatsApp = () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValue({
      id: 'wa-1',
      phoneNumberId: 'pn-1',
      encryptedCredentials: 'enc',
      isChatbotActive: true,
    });
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValue({
      id: 'tpl-1',
      name: 'claire_first_touch',
      languageCode: 'en',
      status: 'approved',
    });
    vi.mocked(decryptCredentials).mockReturnValue({ accessToken: 'tok' });
    vi.mocked(mockWhatsAppCloudService.sendTemplateMessage).mockResolvedValue({
      messageId: 'wamid.1',
      success: true,
    });
    vi.mocked(mockWhatsAppCloudService.getSendHealth).mockResolvedValue({
      canSendMessage: 'AVAILABLE',
      blockers: [],
    });
  };

  it('prefers WhatsApp when the clinic has an account and an approved opener', async () => {
    connectedWhatsApp();

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(result.success && result.data.sent && result.data.channel).toBe(
      'whatsapp'
    );
  });

  // A lead form returns one number, under `phone_number` — WhatsApp is a
  // channel on that number, not a separate identity. Requiring `lead.whatsapp`
  // made WhatsApp ineligible for every real lead and silently forced SMS.
  it('reaches a phone-only lead on WhatsApp, at their phone number', async () => {
    connectedWhatsApp();

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success && result.data.sent && result.data.channel).toBe(
      'whatsapp'
    );
    expect(mockWhatsAppCloudService.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ to: reachableLead.phone })
    );
    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: 'whatsapp',
        // Meta's wa_id — digits, no `+`. See below.
        externalUserId: '353859999999',
      })
    );
  });

  // Meta identifies a WhatsApp user by `wa_id` (digits, no `+`) and every
  // inbound handler stores `msg.from` verbatim. Production holds 2,610 WhatsApp
  // conversations and not one has a `+`, so keying first touch on E.164 could
  // never match an existing conversation.
  //
  // The click-to-WhatsApp path is where that bites: the lead taps the CTA,
  // their message opens a conversation under their wa_id, then the lead-form
  // webhook fires first touch. Keyed on E.164 the dedup misses and Claire says
  // "I'm getting in touch about the form you submitted" to someone already
  // mid-conversation — from a second row that splits the thread.
  it('finds the conversation a click-to-WhatsApp lead already opened', async () => {
    connectedWhatsApp();
    mockDb.query.conversation.findFirst.mockImplementation(() =>
      Promise.resolve({ id: 'conv-from-cta' })
    );

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success && result.data.sent).toBe(false);
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'already_contacted'
    );
    expect(mockWhatsAppCloudService.sendTemplateMessage).not.toHaveBeenCalled();
  });

  // The lookup and the insert both go through `conversationKey`, so pinning the
  // rule pins both: first touch can only find, or collide with, a conversation
  // stored the way inbound stores it.
  describe('conversationKey', () => {
    it('strips WhatsApp numbers to the wa_id Meta sends', () => {
      expect(conversationKey('whatsapp', '+353859999999')).toBe('353859999999');
      expect(conversationKey('whatsapp', '353859999999')).toBe('353859999999');
      expect(conversationKey('whatsapp', '+353 85 999 9999')).toBe(
        '353859999999'
      );
    });

    it('leaves SMS in E.164, which is what Twilio speaks', () => {
      expect(conversationKey('sms', '+353859999999')).toBe('+353859999999');
    });
  });

  // ── Claire must be able to ANSWER before she is allowed to speak first ──
  //
  // The opener asks a question and invites a reply. With the chatbot off, that
  // reply lands in an `agent_handling` conversation and nothing responds
  // (handle-incoming-message logs `bot_suppressed`, reason chatbot_disabled).
  // Measured in production before this gate: of seven clinics with an approved
  // opener template, THREE had isChatbotActive = false — they would have cold-
  // messaged leads and then gone silent.
  describe('chatbot gate', () => {
    const smsBot = (on: boolean) =>
      mockDb.query.orgSmsNumber.findFirst.mockResolvedValue({
        isChatbotActive: on,
      });
    const whatsappBot = (on: boolean) =>
      mockDb.query.whatsappAccount.findFirst.mockResolvedValue({
        id: 'wa-1',
        phoneNumberId: 'pn-1',
        encryptedCredentials: 'enc',
        isChatbotActive: on,
      });

    it('does not send the WhatsApp template when Claire is off there', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(false);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && result.data.sent).toBe(false);
      expect(
        mockWhatsAppCloudService.sendTemplateMessage
      ).not.toHaveBeenCalled();
    });

    // The precise failure this gate exists for: template approved, WABA
    // healthy, lead reachable — and the bot switched off.
    it('reports chatbot_disabled rather than no_eligible_channel', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(false);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'chatbot_disabled'
      );
    });

    // A muted channel must not silently divert the lead onto the other one:
    // SMS with the bot off is the same broken promise as WhatsApp with it off.
    it('does not fall back to SMS when Claire is off on SMS too', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(false);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && result.data.sent).toBe(false);
      expect(deliverSpy).not.toHaveBeenCalled();
    });

    // But a muted WhatsApp SHOULD fall through to a live SMS — the lead still
    // gets an opener from a channel that can answer them.
    it('falls back to SMS when WhatsApp is muted but SMS is live', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(true);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && result.data.sent && result.data.channel).toBe(
        'sms'
      );
      expect(
        mockWhatsAppCloudService.sendTemplateMessage
      ).not.toHaveBeenCalled();
    });

    it('sends on WhatsApp when the template is approved and Claire is on', async () => {
      connectedWhatsApp();
      whatsappBot(true);
      smsBot(true);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && result.data.sent && result.data.channel).toBe(
        'whatsapp'
      );
      expect(mockWhatsAppCloudService.sendTemplateMessage).toHaveBeenCalled();
    });

    // An org with no SMS number at all has no row to read the flag from. That
    // must read as "off", not as "undefined is falsy by luck".
    it('treats a missing SMS number as Claire being off', async () => {
      mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(undefined);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && result.data.sent).toBe(false);
      expect(deliverSpy).not.toHaveBeenCalled();
    });

    // ── the three skips are three different fixes ──────────────────────────
    //
    // A clinic that switched Claire off needs someone to flip a setting. A
    // clinic with no sender has nothing to flip and must connect a channel
    // first. Reporting both as `chatbot_disabled` sends whoever is debugging a
    // silent clinic to the wrong place — production's first real skip (no
    // WhatsApp account, no SMS number) hit exactly that.
    it('reports no_sender_configured when there is no sender to switch on', async () => {
      mockDb.query.whatsappAccount.findFirst.mockResolvedValue(undefined);
      mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(undefined);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'no_sender_configured'
      );
    });

    it('reports chatbot_disabled when an SMS sender exists but is muted', async () => {
      mockDb.query.whatsappAccount.findFirst.mockResolvedValue(undefined);
      smsBot(false);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'chatbot_disabled'
      );
    });

    it('reports chatbot_disabled when WhatsApp is connected but muted', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(undefined);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'chatbot_disabled'
      );
    });

    // An unreachable lead is neither: nothing about the clinic is wrong.
    it('reports no_eligible_channel when the lead has no contact details', async () => {
      mockDb.query.lead.findFirst.mockResolvedValue({
        ...reachableLead,
        phone: null,
        whatsapp: null,
      });
      mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(undefined);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'no_eligible_channel'
      );
    });

    // Same for WhatsApp: no connected account means nothing to answer with.
    it('treats a missing WhatsApp account as Claire being off', async () => {
      mockDb.query.whatsappAccount.findFirst.mockResolvedValue(undefined);
      smsBot(true);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && result.data.sent && result.data.channel).toBe(
        'sms'
      );
    });

    // The gate is about whether Claire can REPLY, not whether the lead is
    // reachable. An unreachable lead is still no_eligible_channel, so the two
    // causes stay distinguishable to whoever is debugging.
    it('still reports no_eligible_channel when the lead is unreachable', async () => {
      mockDb.query.lead.findFirst.mockResolvedValue({
        ...reachableLead,
        phone: null,
        whatsapp: null,
      });
      smsBot(true);

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'no_eligible_channel'
      );
    });

    // Documents the ORDER, which is not obvious: the gate runs before the
    // dedup check, so a muted clinic reports `chatbot_disabled` even for a
    // lead that also already has a conversation. Both mean "nothing sent"; the
    // gate wins because it is the actionable one — a clinic setting, not a
    // property of this lead.
    it('reports the gate, not already_contacted, when both apply', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(false);
      mockDb.query.conversation.findFirst.mockResolvedValue({ id: 'conv-old' });

      const result = await sendLeadFirstTouch(mockDb as never, input);

      expect(result.success && !result.data.sent && result.data.reason).toBe(
        'chatbot_disabled'
      );
    });

    // The skip must leave a TRAIL even though it leaves no conversation.
    // Without it a skipped lead is invisible in SQL — no conversation, no
    // message, nothing on the lead — and the PostHog event says `.success`
    // either way, because ok({ sent: false }) is a successful Result. This is
    // the row that makes "why has this clinic sent nothing?" one query.
    it('records why the opener was skipped', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(false);

      await sendLeadFirstTouch(mockDb as never, input);

      expect(mockDb.values).toHaveBeenCalledWith(
        expect.objectContaining({
          entityType: 'lead',
          entityId: 'lead-1',
          actorType: 'system',
          metadata: expect.objectContaining({
            event: 'first_touch_skipped',
            reason: 'chatbot_disabled',
          }),
        })
      );
    });

    // No conversation row, no lead-stage change, no follow-ups queued — a
    // skipped opener must leave NOTHING behind, or the lead list claims a
    // contact that never happened.
    it('writes nothing when the opener is skipped', async () => {
      connectedWhatsApp();
      whatsappBot(false);
      smsBot(false);

      await sendLeadFirstTouch(mockDb as never, input);

      expectNoConversationOpened();
    });
  });

  // A business-initiated WhatsApp message outside the 24h window MUST be an
  // approved template, so SMS is the designed path — not an afterthought.
  it('falls back to SMS when the opener template is not approved', async () => {
    connectedWhatsApp();
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValue(undefined);

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success && result.data.sent && result.data.channel).toBe(
      'sms'
    );
  });

  it('falls back to SMS when no WhatsApp account is connected', async () => {
    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success && result.data.sent && result.data.channel).toBe(
      'sms'
    );
  });

  it('sends the opener as an approved template on WhatsApp', async () => {
    connectedWhatsApp();

    await sendLeadFirstTouch(mockDb as never, input);

    expect(mockWhatsAppCloudService.sendTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        templateName: 'claire_first_touch',
        languageCode: 'en',
        // positional {{1}}..{{n}}: name, clinic, question
        parameters: expect.objectContaining({
          '0': 'Sarah',
          '1': 'Bloom Clinic',
        }),
      })
    );
  });

  // A WhatsApp opener that does not land is the likeliest failure (no WhatsApp
  // on that number, template paused), and a lead who hears nothing is the whole
  // problem this feature exists to fix.
  it('falls back to SMS when the WhatsApp send fails', async () => {
    connectedWhatsApp();
    vi.mocked(mockWhatsAppCloudService.sendTemplateMessage).mockResolvedValue({
      messageId: '',
      success: false,
    });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(deliverSpy).toHaveBeenCalled();
    expect(result.success && result.data.sent && result.data.channel).toBe(
      'sms'
    );
  });

  it('does not fall back when the lead has no SMS consent', async () => {
    connectedWhatsApp();
    vi.mocked(mockWhatsAppCloudService.sendTemplateMessage).mockResolvedValue({
      messageId: '',
      success: false,
    });
    mockDb.query.lead.findFirst.mockResolvedValue({
      ...reachableLead,
      consentSms: false,
    });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(deliverSpy).not.toHaveBeenCalled();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'delivery_failed'
    );
  });

  // Falling back after `already_contacted` would double-message someone we
  // have already reached on WhatsApp.
  it('does not fall back when WhatsApp was already contacted', async () => {
    connectedWhatsApp();
    mockDb.query.conversation.findFirst.mockResolvedValue({ id: 'conv-old' });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(deliverSpy).not.toHaveBeenCalled();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'already_contacted'
    );
  });

  // Meta ACCEPTS business-initiated sends from a blocked WABA — returns a
  // wamid and "accepted", then drops the message. Without this gate a
  // payment-blocked account silently eats every lead.
  it('falls back to SMS when the WABA cannot initiate conversations', async () => {
    connectedWhatsApp();
    vi.mocked(mockWhatsAppCloudService.getSendHealth).mockResolvedValue({
      canSendMessage: 'BLOCKED',
      blockers: [
        {
          entityType: 'WABA',
          code: 141006,
          description: 'There is an error with the payment method.',
          solution: 'Add a new payment method.',
        },
      ],
    });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(mockWhatsAppCloudService.sendTemplateMessage).not.toHaveBeenCalled();
    expect(result.success && result.data.sent && result.data.channel).toBe(
      'sms'
    );
  });

  it('still uses WhatsApp when health is merely LIMITED', async () => {
    connectedWhatsApp();
    vi.mocked(mockWhatsAppCloudService.getSendHealth).mockResolvedValue({
      canSendMessage: 'LIMITED',
      blockers: [],
    });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success && result.data.sent && result.data.channel).toBe(
      'whatsapp'
    );
  });

  it('sends the composed opener on the SMS path', async () => {
    await sendLeadFirstTouch(mockDb as never, input);

    expect(deliverSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: created.id,
        messages: [
          expect.objectContaining({
            type: 'text',
            text: expect.stringContaining('Claire here from Bloom Clinic'),
          }),
        ],
      })
    );
  });

  // The conversation row is the idempotency record, so it must survive a failed
  // send — but the caller must not be told the lead was contacted.
  it('reports delivery_failed when the send does not land', async () => {
    deliverSpy.mockResolvedValue({ attempted: 1, delivered: 0, failed: 1 });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(result.success && result.data.sent).toBe(false);
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'delivery_failed'
    );
  });

  it('opens the conversation as bot_handling — Claire owns it from the first word', async () => {
    await sendLeadFirstTouch(mockDb as never, input);

    expect(mockDb.values).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'bot_handling',
        platform: 'sms',
        externalUserId: reachableLead.phone,
      })
    );
  });

  // Meta retries the webhook and the queue can redeliver.
  it('does not send twice when a conversation already exists', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue({ id: 'conv-old' });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expectNoConversationOpened();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'already_contacted'
    );
  });

  it('skips a lead with no SMS consent and no WhatsApp route', async () => {
    mockDb.query.lead.findFirst.mockResolvedValue({
      ...reachableLead,
      consentSms: false,
    });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expectNoConversationOpened();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'no_eligible_channel'
    );
  });

  it('skips a lead with no contact details at all', async () => {
    mockDb.query.lead.findFirst.mockResolvedValue({
      ...reachableLead,
      phone: null,
      whatsapp: null,
    });

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'no_eligible_channel'
    );
  });

  // Suppression is the authoritative block — an opener must respect the same
  // list campaigns do.
  it('skips a suppressed contact', async () => {
    mockDb.query.suppression.findMany.mockResolvedValue([
      { channel: 'sms', contact: reachableLead.phone },
      { channel: 'whatsapp', contact: reachableLead.phone },
    ]);

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expectNoConversationOpened();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'no_eligible_channel'
    );
  });

  it('reports a missing lead rather than throwing', async () => {
    mockDb.query.lead.findFirst.mockResolvedValue(undefined);

    const result = await sendLeadFirstTouch(mockDb as never, input);

    expect(result.success).toBe(true);
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'lead_not_found'
    );
  });

  it('returns VALIDATION_ERROR for a missing leadId', async () => {
    const result = await sendLeadFirstTouch(mockDb as never, {
      organizationId: 'org-1',
      leadId: '',
    });

    expect(result.success).toBe(false);
  });
});
