import { describe, expect, it } from '@borradh-workspace/testing';
import {
  META_UTM_MEDIUM,
  META_UTM_SOURCE,
  appendUtmParams,
  hasUtm,
  metaCampaignUtm,
  parseUtmParams,
} from './utm.js';

describe('metaCampaignUtm', () => {
  it('puts the Meta campaign ID — not a name — in utm_campaign', () => {
    // The whole CAC join hangs on this: a display name is editable, the id is
    // not, and a rename must never orphan the leads booked before it.
    expect(metaCampaignUtm('120210000000000')).toEqual({
      source: META_UTM_SOURCE,
      medium: META_UTM_MEDIUM,
      campaign: '120210000000000',
    });
  });

  it('carries the ad id in utm_content when known', () => {
    expect(metaCampaignUtm('camp_1', 'ad_9').content).toBe('ad_9');
  });
});

describe('appendUtmParams', () => {
  it('tags a URL without disturbing what it already carries', () => {
    const url = appendUtmParams('https://salon.com/book?service=botox', {
      source: 'meta',
      campaign: 'camp_1',
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('service')).toBe('botox');
    expect(parsed.searchParams.get('utm_source')).toBe('meta');
    expect(parsed.searchParams.get('utm_campaign')).toBe('camp_1');
    expect(parsed.searchParams.get('utm_medium')).toBeNull();
  });

  it('returns the input unchanged when the URL is unparseable', () => {
    expect(appendUtmParams('not a url', { campaign: 'c' })).toBe('not a url');
  });
});

describe('parseUtmParams', () => {
  it('reads UTMs back off a landing URL', () => {
    expect(
      parseUtmParams(
        'https://salon.com/book?utm_source=meta&utm_medium=paid_social&utm_campaign=camp_1'
      )
    ).toEqual({ source: 'meta', medium: 'paid_social', campaign: 'camp_1' });
  });

  it('round-trips through a host change', () => {
    // The reason micrositeId (not the host) is the attribution key: the same
    // campaign read off two different hosts is the SAME campaign.
    const utm = metaCampaignUtm('camp_1');
    const onBorradh = parseUtmParams(
      appendUtmParams('https://salon.borradh.io/book', utm)
    );
    const onOwnDomain = parseUtmParams(
      appendUtmParams('https://salon.com/book', utm)
    );
    expect(onBorradh).toEqual(onOwnDomain);
  });

  it('is empty for an organic visit', () => {
    const utm = parseUtmParams('https://salon.com/book');
    expect(utm).toEqual({});
    expect(hasUtm(utm)).toBe(false);
  });
});
