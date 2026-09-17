import { describe, expect, it } from '@borradh-workspace/testing';
import {
  type EligibilityLead,
  buildSuppressionIndex,
  contactForChannel,
  eligibleChannels,
  emptySuppressionIndex,
  isChannelEligible,
  normalizeContact,
} from './channel-eligibility.js';

/**
 * A realistically-shaped lead: the Meta lead-form webhook writes `phone` and
 * never `whatsapp` (that column is only populated when a lead messages us on
 * WhatsApp first). Seeding both hid the bug where WhatsApp was ineligible for
 * every real lead-form lead.
 */
const lead = (overrides: Partial<EligibilityLead> = {}): EligibilityLead => ({
  id: 'lead_1',
  email: 'jane@example.com',
  phone: '+15550101234',
  whatsapp: null,
  consentEmail: true,
  consentSms: true,
  ...overrides,
});

describe('normalizeContact', () => {
  it('lowercases and trims emails', () => {
    expect(normalizeContact('email', '  Jane@Example.COM ')).toBe(
      'jane@example.com'
    );
  });

  it('reduces phone numbers to digits, preserving a leading +', () => {
    expect(normalizeContact('sms', '+1 (555) 010-1234')).toBe('+15550101234');
    expect(normalizeContact('whatsapp', '555.010.1234')).toBe('5550101234');
  });
});

describe('contactForChannel', () => {
  it('maps each channel to its contact field', () => {
    const l = lead({ email: 'a@b.com', phone: '+1', whatsapp: '+2' });
    expect(contactForChannel(l, 'email')).toBe('a@b.com');
    expect(contactForChannel(l, 'sms')).toBe('+1');
    expect(contactForChannel(l, 'whatsapp')).toBe('+2');
  });

  it('falls back to phone for whatsapp when the lead has no whatsapp column', () => {
    // The shape every Meta lead-form lead actually has.
    expect(contactForChannel(lead(), 'whatsapp')).toBe('+15550101234');
  });

  it('is null for whatsapp when the lead has no number at all', () => {
    expect(
      contactForChannel(lead({ phone: null, whatsapp: null }), 'whatsapp')
    ).toBeNull();
  });
});

describe('isChannelEligible', () => {
  it('email requires consentEmail + an email address', () => {
    expect(isChannelEligible(lead(), 'email')).toBe(true);
    expect(isChannelEligible(lead({ consentEmail: false }), 'email')).toBe(
      false
    );
    expect(isChannelEligible(lead({ email: null }), 'email')).toBe(false);
  });

  it('sms requires consentSms + a phone number', () => {
    expect(isChannelEligible(lead(), 'sms')).toBe(true);
    expect(isChannelEligible(lead({ consentSms: false }), 'sms')).toBe(false);
    expect(isChannelEligible(lead({ phone: null }), 'sms')).toBe(false);
  });

  it('whatsapp requires a reachable number but no explicit consent flag', () => {
    expect(isChannelEligible(lead({ consentSms: false }), 'whatsapp')).toBe(
      true
    );
    expect(
      isChannelEligible(lead({ phone: null, whatsapp: null }), 'whatsapp')
    ).toBe(false);
  });

  it('whatsapp is eligible for a lead-form lead that only has a phone', () => {
    expect(isChannelEligible(lead({ whatsapp: null }), 'whatsapp')).toBe(true);
  });

  it('suppression blocks an otherwise-eligible lead (format-insensitive)', () => {
    const suppression = buildSuppressionIndex([
      { channel: 'email', contact: 'JANE@example.com' },
      { channel: 'sms', contact: '+1 555 010 1234' },
    ]);
    expect(isChannelEligible(lead(), 'email', suppression)).toBe(false);
    expect(isChannelEligible(lead(), 'sms', suppression)).toBe(false);
    // whatsapp not in the suppression list → still eligible
    expect(isChannelEligible(lead(), 'whatsapp', suppression)).toBe(true);
  });
});

describe('eligibleChannels', () => {
  it('returns only the reachable channels', () => {
    const l = lead({ phone: null, consentEmail: true });
    expect(eligibleChannels(l, ['email', 'sms', 'whatsapp'])).toEqual([
      'email',
    ]);
  });

  it('respects suppression across the set', () => {
    // Suppressing the number blocks WhatsApp even though it is reached via
    // the `phone` column.
    const suppression = buildSuppressionIndex([
      { channel: 'whatsapp', contact: '+15550101234' },
    ]);
    expect(
      eligibleChannels(lead(), ['email', 'sms', 'whatsapp'], suppression)
    ).toEqual(['email', 'sms']);
  });

  it('empty suppression index is a no-op', () => {
    expect(
      eligibleChannels(lead(), ['email'], emptySuppressionIndex())
    ).toEqual(['email']);
  });
});
