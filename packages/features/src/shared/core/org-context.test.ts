import { describe, expect, it } from '@borradh-workspace/testing';
import { type OrgContext, buildOrgContextBlock } from './org-context.js';

const baseOrg: OrgContext = {
  businessType: 'aesthetic_clinic' as OrgContext['businessType'],
  brandVoice: ['warm', 'confident'],
  targetAudienceDescription: null,
  credibilityLine: null,
  tagline: null,
  services: [],
  serviceDetails: [],
};

describe('buildOrgContextBlock — content rules', () => {
  it('omits the rules block entirely when there are none', () => {
    expect(buildOrgContextBlock(baseOrg)).not.toContain('Content rules');
    expect(
      buildOrgContextBlock({ ...baseOrg, contentRules: [] })
    ).not.toContain('Content rules');
  });

  it('renders each rule as its own line', () => {
    const block = buildOrgContextBlock({
      ...baseOrg,
      contentRules: [
        'Always mention the €50 deposit.',
        'One hashtag, not three.',
      ],
    });

    expect(block).toContain('- Always mention the €50 deposit.');
    expect(block).toContain('- One hashtag, not three.');
  });

  it('states the rules are non-negotiable and win conflicts', () => {
    // Without this the rules read as one more suggestion among many and lose
    // to the house defaults they exist to override.
    const block = buildOrgContextBlock({
      ...baseOrg,
      contentRules: ['One hashtag, not three.'],
    });

    expect(block).toMatch(/not optional/i);
    expect(block).toMatch(/rule wins/i);
  });

  it('places the rules above the background context', () => {
    const block = buildOrgContextBlock({
      ...baseOrg,
      services: ['Profhilo'],
      contentRules: ['One hashtag, not three.'],
    });

    expect(block.indexOf('One hashtag')).toBeLessThan(
      block.indexOf('Services offered')
    );
  });
});
