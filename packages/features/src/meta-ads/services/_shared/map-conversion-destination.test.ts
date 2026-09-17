import { describe, expect, it } from '@borradh-workspace/testing';
import {
  mapConversionDestination,
  resolveDestinationType,
} from './map-conversion-destination.js';

describe('mapConversionDestination', () => {
  it('maps chatbot with engagement objective to automatic destination', () => {
    expect(
      mapConversionDestination('chatbot', 'messenger', 'OUTCOME_ENGAGEMENT')
    ).toBe('MESSAGING_INSTAGRAM_DIRECT_MESSENGER');
  });

  it('maps chatbot with leads objective to MESSENGER', () => {
    expect(
      mapConversionDestination('chatbot', 'messenger', 'OUTCOME_LEADS')
    ).toBe('MESSENGER');
  });

  it('maps chatbot with no objective to MESSENGER (safe default)', () => {
    expect(mapConversionDestination('chatbot', 'messenger')).toBe('MESSENGER');
  });

  it('maps chatbot with null objective to MESSENGER', () => {
    expect(mapConversionDestination('chatbot', null, null)).toBe('MESSENGER');
  });

  it('maps chatbot with whatsapp to WHATSAPP regardless of objective', () => {
    expect(
      mapConversionDestination('chatbot', 'whatsapp', 'OUTCOME_ENGAGEMENT')
    ).toBe('WHATSAPP');
    expect(
      mapConversionDestination('chatbot', 'whatsapp', 'OUTCOME_LEADS')
    ).toBe('WHATSAPP');
  });

  it('maps lead_form to ON_AD', () => {
    expect(mapConversionDestination('lead_form')).toBe('ON_AD');
  });

  it('maps website to WEBSITE', () => {
    expect(mapConversionDestination('website')).toBe('WEBSITE');
  });

  it('maps email_only to WEBSITE', () => {
    expect(mapConversionDestination('email_only')).toBe('WEBSITE');
  });

  it('maps sequence to WEBSITE', () => {
    expect(mapConversionDestination('sequence')).toBe('WEBSITE');
  });
});

describe('resolveDestinationType', () => {
  describe('single destination', () => {
    it('whatsapp alone → WHATSAPP', () => {
      expect(
        resolveDestinationType({
          destinations: ['whatsapp'],
          objective: 'OUTCOME_ENGAGEMENT',
        })
      ).toBe('WHATSAPP');
    });

    it('messenger alone → MESSENGER', () => {
      expect(
        resolveDestinationType({
          destinations: ['messenger'],
          objective: 'OUTCOME_ENGAGEMENT',
        })
      ).toBe('MESSENGER');
    });

    it('instagram_dm alone → INSTAGRAM_DIRECT', () => {
      expect(
        resolveDestinationType({
          destinations: ['instagram_dm'],
          objective: 'OUTCOME_ENGAGEMENT',
        })
      ).toBe('INSTAGRAM_DIRECT');
    });
  });

  describe('pair destinations', () => {
    it('messenger + whatsapp → MESSAGING_MESSENGER_WHATSAPP', () => {
      expect(
        resolveDestinationType({
          destinations: ['messenger', 'whatsapp'],
          objective: 'OUTCOME_ENGAGEMENT',
        })
      ).toBe('MESSAGING_MESSENGER_WHATSAPP');
    });

    it('messenger + instagram_dm → MESSAGING_INSTAGRAM_DIRECT_MESSENGER', () => {
      expect(
        resolveDestinationType({
          destinations: ['messenger', 'instagram_dm'],
          objective: 'OUTCOME_ENGAGEMENT',
        })
      ).toBe('MESSAGING_INSTAGRAM_DIRECT_MESSENGER');
    });

    it('instagram_dm + whatsapp auto-includes Messenger and uses triple combo', () => {
      // Meta has no combo for {instagram_dm, whatsapp} without Messenger,
      // so the mapper auto-includes Messenger. For OUTCOME_LEADS this
      // collapses to WHATSAPP (priority order).
      expect(
        resolveDestinationType({
          destinations: ['instagram_dm', 'whatsapp'],
          objective: 'OUTCOME_AWARENESS',
        })
      ).toBe('MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP');
    });
  });

  describe('triple combo (EU restriction)', () => {
    it('drops WhatsApp when OUTCOME_ENGAGEMENT is selected', () => {
      expect(
        resolveDestinationType({
          destinations: ['whatsapp', 'messenger', 'instagram_dm'],
          objective: 'OUTCOME_ENGAGEMENT',
        })
      ).toBe('MESSAGING_INSTAGRAM_DIRECT_MESSENGER');
    });

    it('uses the full triple combo when objective is not OUTCOME_ENGAGEMENT', () => {
      expect(
        resolveDestinationType({
          destinations: ['whatsapp', 'messenger', 'instagram_dm'],
          objective: 'OUTCOME_AWARENESS',
        })
      ).toBe('MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP');
    });

    it('throws when throwOnEuTripleCombo is set and objective is OUTCOME_ENGAGEMENT', () => {
      expect(() =>
        resolveDestinationType({
          destinations: ['whatsapp', 'messenger', 'instagram_dm'],
          objective: 'OUTCOME_ENGAGEMENT',
          throwOnEuTripleCombo: true,
        })
      ).toThrow(/not supported with OUTCOME_ENGAGEMENT/i);
    });
  });

  describe('OUTCOME_LEADS collapses to single destination', () => {
    it('prefers WhatsApp when present', () => {
      expect(
        resolveDestinationType({
          destinations: ['whatsapp', 'messenger', 'instagram_dm'],
          objective: 'OUTCOME_LEADS',
        })
      ).toBe('WHATSAPP');
    });

    it('falls back to Messenger when WhatsApp is not selected', () => {
      expect(
        resolveDestinationType({
          destinations: ['messenger', 'instagram_dm'],
          objective: 'OUTCOME_LEADS',
        })
      ).toBe('MESSENGER');
    });

    it('falls back to Messenger even when only instagram_dm is selected (LEADS does not support IG_DIRECT)', () => {
      expect(
        resolveDestinationType({
          destinations: ['instagram_dm'],
          objective: 'OUTCOME_LEADS',
        })
      ).toBe('MESSENGER');
    });
  });
});
