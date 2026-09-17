import { describe, expect, it } from '@borradh-workspace/testing';
import { resolvePrivacyPolicyUrl } from './resolve-privacy-policy-url.js';

describe('resolvePrivacyPolicyUrl', () => {
  it('prefers a dedicated privacy policy over website / Facebook Page', () => {
    expect(
      resolvePrivacyPolicyUrl({
        privacyPolicyUrl: 'https://clinic.example/privacy',
        websiteUrl: 'https://clinic.example',
        facebookPageUrl: 'https://facebook.com/clinic',
      })
    ).toBe('https://clinic.example/privacy');
  });

  it('falls back to the website when no dedicated policy is set', () => {
    expect(
      resolvePrivacyPolicyUrl({
        privacyPolicyUrl: null,
        websiteUrl: 'https://clinic.example',
        facebookPageUrl: 'https://facebook.com/clinic',
      })
    ).toBe('https://clinic.example');
  });

  it('falls back to the Facebook Page when only that is set', () => {
    expect(
      resolvePrivacyPolicyUrl({
        websiteUrl: null,
        facebookPageUrl: 'https://facebook.com/clinic',
      })
    ).toBe('https://facebook.com/clinic');
  });

  it('adds a protocol to a bare domain so Meta gets a valid URL', () => {
    expect(resolvePrivacyPolicyUrl({ websiteUrl: 'clinic.example' })).toBe(
      'https://clinic.example'
    );
  });

  it('returns null when nothing usable exists', () => {
    expect(
      resolvePrivacyPolicyUrl({
        privacyPolicyUrl: '  ',
        websiteUrl: null,
        facebookPageUrl: undefined,
      })
    ).toBeNull();
  });
});
