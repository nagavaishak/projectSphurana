import type { OrgSmsNumber, OrgSmsSender } from '@borradh-workspace/database';
import { describe, expect, it } from '@borradh-workspace/testing';
import { resolveSmsSender } from './resolve-sms-sender.js';

const senderRow = (o: Partial<OrgSmsSender>): OrgSmsSender =>
  ({
    id: 's1',
    organizationId: 'org_1',
    mode: 'alpha',
    senderId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as OrgSmsSender;

const numberRow = (o: Partial<OrgSmsNumber>): OrgSmsNumber =>
  ({
    id: 'n1',
    organizationId: 'org_1',
    phoneNumber: '+353850000000',
    twilioSid: 'PN1',
    country: 'IE',
    tenDlcCampaignSid: null,
    status: 'active',
    provisionedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...o,
  }) as OrgSmsNumber;

describe('resolveSmsSender', () => {
  it('defaults to alpha derived from the org name when no row exists', () => {
    const r = resolveSmsSender({
      sender: null,
      number: null,
      orgName: 'Bloom Hair',
    });
    expect(r).toEqual({ mode: 'alpha', senderId: 'BloomHair' });
  });

  it('uses an explicit alpha override', () => {
    const r = resolveSmsSender({
      sender: senderRow({ senderId: 'GlowSpa' }),
      number: null,
      orgName: 'Ignored Name',
    });
    expect(r).toEqual({ mode: 'alpha', senderId: 'GlowSpa' });
  });

  it('returns none when the override is not a valid sender ID', () => {
    const r = resolveSmsSender({
      sender: senderRow({ senderId: 'Bloom Hair!!' }),
      number: null,
      orgName: 'Bloom Hair',
    });
    expect(r.mode).toBe('none');
  });

  it('returns none for alpha when the name cannot derive an id and no override', () => {
    const r = resolveSmsSender({
      sender: null,
      number: null,
      orgName: '12345',
    });
    expect(r.mode).toBe('none');
  });

  it('uses the active number in number mode', () => {
    const r = resolveSmsSender({
      sender: senderRow({ mode: 'number' }),
      number: numberRow({ status: 'active' }),
      orgName: 'Bloom Hair',
    });
    expect(r).toEqual({ mode: 'number', phoneNumber: '+353850000000' });
  });

  it('returns none in number mode when the number is not active', () => {
    const r = resolveSmsSender({
      sender: senderRow({ mode: 'number' }),
      number: numberRow({ status: 'provisioning' }),
      orgName: 'Bloom Hair',
    });
    expect(r.mode).toBe('none');
  });
});
