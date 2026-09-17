import {
  beforeEach,
  createMockDatabase,
  describe,
  expect,
  it,
  vi,
} from '@borradh-workspace/testing';
import type { DbConnection } from '../../../shared/index.js';
import {
  type PreflightMessage,
  collectLaunchBlockers,
} from './launch-preflight.js';

const ORG = 'org_1';

const emailMsg: PreflightMessage = {
  channel: 'email',
  subject: 'Hi there',
  body: 'Hello {{firstName|there}}',
};
const smsMsg: PreflightMessage = {
  channel: 'sms',
  subject: null,
  body: 'Quick offer for you',
};
const waMsg: PreflightMessage = {
  channel: 'whatsapp',
  subject: null,
  body: 'Message on WhatsApp',
  whatsappTemplateId: 'wat_1',
};

describe('collectLaunchBlockers', () => {
  const mockDb = createMockDatabase();
  const db = mockDb as unknown as DbConnection;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb._resetMocks();
  });

  /** Make every deliverability lookup succeed. */
  function withDeliverableOrg() {
    // No sender row + no number ⇒ alpha default, derived from the org name.
    mockDb.query.orgSmsSender.findFirst.mockResolvedValue(null);
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null);
    mockDb.query.organization.findFirst.mockResolvedValue({
      name: 'Bloom Hair',
    });
    mockDb.query.creditBalances.findFirst.mockResolvedValue({ balance: 5000 });
    mockDb.query.whatsappAccount.findFirst.mockResolvedValue({ id: 'wa_1' });
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValue({
      id: 'wat_1',
      status: 'approved',
    });
  }

  it('returns no blockers when every selected channel is ready', async () => {
    withDeliverableOrg();
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['email', 'sms', 'whatsapp'],
      messages: [emailMsg, smsMsg, waMsg],
    });
    expect(blockers).toEqual([]);
  });

  it('blocks a selected channel that has no message content', async () => {
    withDeliverableOrg();
    // sms selected but only an email message authored
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['email', 'sms'],
      messages: [emailMsg],
    });
    expect(blockers).toHaveLength(1);
    expect(blockers[0]).toMatchObject({
      channel: 'sms',
      reason: 'missing_content',
    });
  });

  it('treats a whitespace-only body as missing content', async () => {
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['email'],
      messages: [{ channel: 'email', subject: 'Subject', body: '   ' }],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'email',
      reason: 'missing_content',
    });
  });

  it('blocks email with an empty subject', async () => {
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['email'],
      messages: [{ channel: 'email', subject: '', body: 'Body here' }],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'email',
      reason: 'missing_subject',
    });
  });

  it('does NOT block SMS with no number — falls back to an alpha sender', async () => {
    mockDb.query.orgSmsSender.findFirst.mockResolvedValue(null);
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null);
    mockDb.query.organization.findFirst.mockResolvedValue({
      name: 'Bloom Hair',
    });
    mockDb.query.creditBalances.findFirst.mockResolvedValue({ balance: 5000 });
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['sms'],
      messages: [smsMsg],
    });
    expect(blockers).toEqual([]);
  });

  it('blocks SMS when no sender can be resolved (name yields no valid alpha id)', async () => {
    mockDb.query.orgSmsSender.findFirst.mockResolvedValue(null);
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null);
    mockDb.query.organization.findFirst.mockResolvedValue({ name: '12345' });
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['sms'],
      messages: [smsMsg],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'sms',
      reason: 'no_sms_sender',
    });
  });

  it('blocks SMS when the sender resolves but there are no credits', async () => {
    mockDb.query.orgSmsSender.findFirst.mockResolvedValue(null);
    mockDb.query.orgSmsNumber.findFirst.mockResolvedValue(null);
    mockDb.query.organization.findFirst.mockResolvedValue({
      name: 'Bloom Hair',
    });
    mockDb.query.creditBalances.findFirst.mockResolvedValue({ balance: 0 });
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['sms'],
      messages: [smsMsg],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'sms',
      reason: 'insufficient_credits',
    });
  });

  it('blocks WhatsApp when the org has no active account', async () => {
    mockDb.query.whatsappAccount.findFirst.mockResolvedValue(null);
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['whatsapp'],
      messages: [waMsg],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'whatsapp',
      reason: 'no_whatsapp_account',
    });
  });

  it('blocks WhatsApp with no template — bulk WhatsApp is template-only', async () => {
    withDeliverableOrg();
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['whatsapp'],
      messages: [{ ...waMsg, whatsappTemplateId: null }],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'whatsapp',
      reason: 'whatsapp_template_required',
    });
  });

  it('blocks WhatsApp when the selected template is not approved', async () => {
    withDeliverableOrg();
    mockDb.query.whatsappTemplate.findFirst.mockResolvedValue({
      id: 'wat_1',
      status: 'paused',
    });
    const blockers = await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['whatsapp'],
      messages: [waMsg],
    });
    expect(blockers[0]).toMatchObject({
      channel: 'whatsapp',
      reason: 'whatsapp_template_not_approved',
    });
  });

  it('does not run a deliverability check when content is already missing', async () => {
    // sms has no message → we should not even query for a number/credits
    await collectLaunchBlockers(db, {
      organizationId: ORG,
      channels: ['sms'],
      messages: [],
    });
    expect(mockDb.query.orgSmsNumber.findFirst).not.toHaveBeenCalled();
    expect(mockDb.query.creditBalances.findFirst).not.toHaveBeenCalled();
  });
});
