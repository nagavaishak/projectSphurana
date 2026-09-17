import { describe, expect, it } from '@borradh-workspace/testing';
import {
  extractMergeFields,
  fieldsWithoutFallback,
  interpolateCampaignBody,
  unknownMergeFields,
} from './interpolate-campaign-body.js';

describe('interpolateCampaignBody', () => {
  it('substitutes present fields', () => {
    expect(
      interpolateCampaignBody('Hi {{firstName}}', { firstName: 'Jane' })
    ).toBe('Hi Jane');
  });

  it('uses the fallback when the field is missing, null, or blank', () => {
    expect(interpolateCampaignBody('Hi {{firstName|there}}', {})).toBe(
      'Hi there'
    );
    expect(
      interpolateCampaignBody('Hi {{firstName|there}}', { firstName: null })
    ).toBe('Hi there');
    expect(
      interpolateCampaignBody('Hi {{firstName|there}}', { firstName: '   ' })
    ).toBe('Hi there');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolateCampaignBody('Hi {{ firstName | there }}', {})).toBe(
      'Hi there'
    );
  });

  it('blanks a missing field that has no fallback', () => {
    expect(interpolateCampaignBody('Hi {{firstName}}', {})).toBe('Hi ');
  });

  it('coerces numeric values', () => {
    expect(interpolateCampaignBody('{{count}} spots left', { count: 3 })).toBe(
      '3 spots left'
    );
  });
});

describe('extractMergeFields', () => {
  it('returns distinct field names', () => {
    expect(extractMergeFields('{{a}} {{b}} {{a|x}}').sort()).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('fieldsWithoutFallback', () => {
  it('flags only fields lacking a fallback', () => {
    expect(
      fieldsWithoutFallback('{{firstName}} loves {{offer|our deal}}')
    ).toEqual(['firstName']);
  });
});

describe('unknownMergeFields', () => {
  it('returns fields outside the allowed set', () => {
    expect(
      unknownMergeFields('{{firstName}} {{bogus}}', ['firstName'])
    ).toEqual(['bogus']);
  });
});
