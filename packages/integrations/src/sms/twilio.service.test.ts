import { describe, expect, it } from 'vitest';
import { TwilioSMSService, parseSmsKeyword } from './twilio.service.js';

describe('parseSmsKeyword', () => {
  it('detects opt-out keywords (case/space-insensitive)', () => {
    for (const w of [
      'STOP',
      'stop',
      '  Stop  ',
      'UNSUBSCRIBE',
      'cancel',
      'END',
      'quit',
      'STOPALL',
    ]) {
      expect(parseSmsKeyword(w)).toBe('opt_out');
    }
  });

  it('detects opt-in keywords', () => {
    for (const w of ['START', 'yes', 'UNSTOP']) {
      expect(parseSmsKeyword(w)).toBe('opt_in');
    }
  });

  it('returns null for normal messages and empties', () => {
    expect(parseSmsKeyword('I want to book an appointment')).toBeNull();
    expect(parseSmsKeyword('')).toBeNull();
  });

  it('keys off the first word only', () => {
    expect(parseSmsKeyword('STOP texting me')).toBe('opt_out');
    expect(parseSmsKeyword('please stop')).toBeNull();
  });
});

describe('TwilioSMSService dryRun', () => {
  it('sendSMS returns a synthetic id without calling the API', async () => {
    const svc = new TwilioSMSService({
      apiSid: 'SKx',
      secret: 's',
      dryRun: true,
    });
    const r = await svc.sendSMS({
      to: '+15550000000',
      body: 'hi',
      from: '+15551112222',
    });
    expect(r.success).toBe(true);
    expect(r.status).toBe('dry_run');
    expect(r.messageId).toMatch(/^SMdryrun/);
  });

  it('provisionNumber returns a synthetic sid', async () => {
    const svc = new TwilioSMSService({ dryRun: true });
    const r = await svc.provisionNumber({ phoneNumber: '+15551112222' });
    expect(r.sid).toMatch(/^PNdryrun/);
    expect(r.phoneNumber).toBe('+15551112222');
  });
});
