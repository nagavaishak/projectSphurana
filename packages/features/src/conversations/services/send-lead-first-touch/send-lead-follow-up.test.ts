import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from '@borradh-workspace/testing';
import { type MockInstance, vi } from 'vitest';

import * as chatbots from '../../../chatbots/index.js';
import * as leads from '../../../leads/index.js';
import { sendLeadFollowUp } from './send-lead-follow-up.service.js';

const mockDb = {
  query: {
    conversation: { findFirst: vi.fn() },
    conversationMessage: { findFirst: vi.fn() },
    lead: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    whatsappAccount: { findFirst: vi.fn() },
    whatsappTemplate: { findFirst: vi.fn() },
  },
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue(undefined),
};

const input = {
  organizationId: 'org-1',
  leadId: 'lead-1',
  conversationId: 'conv-1',
  step: 'followup_1' as const,
};

describe('sendLeadFollowUp', () => {
  let deliverSpy: MockInstance;
  let stageSpy: MockInstance;

  beforeEach(() => {
    vi.clearAllMocks();
    deliverSpy = vi
      .spyOn(chatbots, 'deliverMessages')
      .mockResolvedValue({ attempted: 1, delivered: 1, failed: 0 });
    stageSpy = vi.spyOn(leads, 'advanceLeadStage').mockResolvedValue(undefined);

    mockDb.query.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      organizationId: 'org-1',
      platform: 'sms',
      externalUserId: '+353859999999',
      whatsappAccountId: null,
    });
    mockDb.query.conversationMessage.findFirst.mockResolvedValue(undefined);
    mockDb.query.lead.findFirst.mockResolvedValue({
      id: 'lead-1',
      firstName: 'Sarah',
    });
    mockDb.query.organization.findFirst.mockResolvedValue({
      id: 'org-1',
      name: 'Bloom Clinic',
    });
  });

  afterEach(() => {
    deliverSpy.mockRestore();
    stageSpy.mockRestore();
  });

  it('sends the nudge when the lead has not replied', async () => {
    const result = await sendLeadFollowUp(mockDb as never, input);

    expect(result.success && result.data.sent).toBe(true);
    expect(deliverSpy).toHaveBeenCalled();
  });

  // The stop condition is checked here, at fire time, rather than by cancelling
  // the job: a cancellation that silently fails nudges someone who replied.
  it('does not nudge a lead who already replied', async () => {
    mockDb.query.conversationMessage.findFirst.mockResolvedValue({
      id: 'msg-1',
      role: 'user',
    });

    const result = await sendLeadFollowUp(mockDb as never, input);

    expect(deliverSpy).not.toHaveBeenCalled();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'lead_replied'
    );
  });

  it('marks the lead lost after the second nudge', async () => {
    await sendLeadFollowUp(mockDb as never, { ...input, step: 'followup_2' });

    expect(stageSpy).toHaveBeenCalledWith(
      mockDb,
      expect.objectContaining({ from: 'contacted', to: 'lost' })
    );
  });

  it('does not mark lost after the first nudge — the sequence is not over', async () => {
    await sendLeadFollowUp(mockDb as never, input);

    expect(stageSpy).not.toHaveBeenCalled();
  });

  it('does not mark lost when the second nudge failed to send', async () => {
    deliverSpy.mockResolvedValue({ attempted: 1, delivered: 0, failed: 1 });

    const result = await sendLeadFollowUp(mockDb as never, {
      ...input,
      step: 'followup_2',
    });

    expect(stageSpy).not.toHaveBeenCalled();
    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'delivery_failed'
    );
  });

  // A WhatsApp nudge is business-initiated, so without an approved template it
  // must not be attempted at all.
  it('skips a WhatsApp nudge with no approved follow-up template', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue({
      id: 'conv-1',
      organizationId: 'org-1',
      platform: 'whatsapp',
      externalUserId: '+353859999999',
      whatsappAccountId: 'wa-1',
    });
    mockDb.query.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa-1' });
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValue(undefined);

    const result = await sendLeadFollowUp(mockDb as never, input);

    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'no_template'
    );
  });

  it('reports a missing conversation rather than throwing', async () => {
    mockDb.query.conversation.findFirst.mockResolvedValue(undefined);

    const result = await sendLeadFollowUp(mockDb as never, input);

    expect(result.success && !result.data.sent && result.data.reason).toBe(
      'conversation_not_found'
    );
  });
});
