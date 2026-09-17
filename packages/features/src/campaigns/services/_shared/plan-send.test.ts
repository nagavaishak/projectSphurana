import { describe, expect, it } from '@borradh-workspace/testing';
import {
  buildSuppressionIndex,
  emptySuppressionIndex,
} from './channel-eligibility.js';
import { buildLeadMergeData, planSend } from './plan-send.js';

const lead = {
  id: 'l1',
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '+15550101234',
  whatsapp: '+15550101234',
  consentEmail: true,
  consentSms: true,
};

const base = {
  channel: 'email' as const,
  lead,
  suppression: emptySuppressionIndex(),
  bodyTemplate: 'Hi {{firstName|there}}, welcome!',
  mergeData: buildLeadMergeData(lead),
};

describe('planSend', () => {
  it('sends and interpolates for a queued, eligible recipient', () => {
    const plan = planSend({ ...base, recipientStatus: 'queued' });
    expect(plan.action).toBe('send');
    expect(plan.contact).toBe('jane@example.com');
    expect(plan.body).toBe('Hi Jane, welcome!');
  });

  it('interpolates WhatsApp template params per lead', () => {
    const plan = planSend({
      ...base,
      channel: 'whatsapp',
      recipientStatus: 'queued',
      whatsappTemplate: {
        name: 'june_offer',
        languageCode: 'en',
        params: ['{{firstName|there}}', '20% off', '{{missing|this week}}'],
      },
    });
    expect(plan.action).toBe('send');
    expect(plan.whatsappTemplate).toEqual({
      name: 'june_offer',
      languageCode: 'en',
      parameters: ['Jane', '20% off', 'this week'],
    });
  });

  it('omits whatsappTemplate from the plan when not provided', () => {
    const plan = planSend({ ...base, recipientStatus: 'queued' });
    expect(plan.whatsappTemplate).toBeUndefined();
  });

  it('skips a non-queued recipient (idempotency)', () => {
    expect(planSend({ ...base, recipientStatus: 'sent' }).action).toBe(
      'skip_not_queued'
    );
  });

  it('skips when suppressed', () => {
    const plan = planSend({
      ...base,
      recipientStatus: 'queued',
      suppression: buildSuppressionIndex([
        { channel: 'email', contact: 'jane@example.com' },
      ]),
    });
    expect(plan.action).toBe('skip_ineligible');
  });

  it('skips when consent is missing', () => {
    const plan = planSend({
      ...base,
      lead: { ...lead, consentEmail: false },
      recipientStatus: 'queued',
    });
    expect(plan.action).toBe('skip_ineligible');
  });

  it('falls back when a merge field is missing', () => {
    const plan = planSend({
      ...base,
      lead: { ...lead, firstName: null },
      mergeData: buildLeadMergeData({ ...lead, firstName: null }),
      recipientStatus: 'queued',
    });
    expect(plan.body).toBe('Hi there, welcome!');
  });
});
