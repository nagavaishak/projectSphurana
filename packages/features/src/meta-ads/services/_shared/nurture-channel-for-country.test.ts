import { describe, expect, it } from '@borradh-workspace/testing';
import { resolveNurtureChannel } from './nurture-channel-for-country.js';

describe('resolveNurtureChannel', () => {
  it('US → Messenger even when WhatsApp is connected', () => {
    expect(
      resolveNurtureChannel({ countryCode: 'us', hasUsableWhatsApp: true })
    ).toEqual({ channel: 'messenger', flagged: false });
  });

  it('UK → WhatsApp when connected', () => {
    expect(
      resolveNurtureChannel({ countryCode: 'gb', hasUsableWhatsApp: true })
    ).toEqual({ channel: 'whatsapp', flagged: false });
  });

  it('Ireland → WhatsApp when connected', () => {
    expect(
      resolveNurtureChannel({ countryCode: 'ie', hasUsableWhatsApp: true })
    ).toEqual({ channel: 'whatsapp', flagged: false });
  });

  it('UK → Messenger + flagged when WhatsApp not connected', () => {
    const result = resolveNurtureChannel({
      countryCode: 'gb',
      hasUsableWhatsApp: false,
    });
    expect(result.channel).toBe('messenger');
    expect(result.flagged).toBe(true);
    expect(result.reason).toMatch(/WhatsApp isn't connected/);
  });

  it('Ireland → Messenger + flagged when WhatsApp not connected', () => {
    const result = resolveNurtureChannel({
      countryCode: 'ie',
      hasUsableWhatsApp: false,
    });
    expect(result.channel).toBe('messenger');
    expect(result.flagged).toBe(true);
  });

  it('other country → WhatsApp when connected (legacy behaviour), not flagged', () => {
    expect(
      resolveNurtureChannel({ countryCode: 'fr', hasUsableWhatsApp: true })
    ).toEqual({ channel: 'whatsapp', flagged: false });
  });

  it('other country → Messenger when WhatsApp not connected, not flagged', () => {
    expect(
      resolveNurtureChannel({ countryCode: 'fr', hasUsableWhatsApp: false })
    ).toEqual({ channel: 'messenger', flagged: false });
  });

  it('unknown / missing country → falls back to connection-based default', () => {
    expect(
      resolveNurtureChannel({ countryCode: null, hasUsableWhatsApp: true })
    ).toEqual({ channel: 'whatsapp', flagged: false });
    expect(
      resolveNurtureChannel({
        countryCode: undefined,
        hasUsableWhatsApp: false,
      })
    ).toEqual({ channel: 'messenger', flagged: false });
  });

  it('normalises country casing/whitespace', () => {
    expect(
      resolveNurtureChannel({ countryCode: ' GB ', hasUsableWhatsApp: true })
        .channel
    ).toBe('whatsapp');
    expect(
      resolveNurtureChannel({ countryCode: 'US', hasUsableWhatsApp: true })
        .channel
    ).toBe('messenger');
  });
});
