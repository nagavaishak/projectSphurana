import { BLOCK_VARIANTS } from '@borradh-workspace/web-shared';
import { describe, expect, it } from 'vitest';
import {
  EDITABLE_FIELDS,
  editableAttrs,
  hasChanged,
  isEditableField,
  isTrustedOrigin,
  parseCanvasMessage,
  sanitizeEditableText,
  toOrigin,
} from './editable';

describe('EDITABLE_FIELDS', () => {
  it('covers every block type in the contract', () => {
    expect(Object.keys(EDITABLE_FIELDS).sort()).toEqual(
      Object.keys(BLOCK_VARIANTS).sort()
    );
  });

  it('matches §2 of the inline edit contract exactly', () => {
    expect(EDITABLE_FIELDS).toEqual({
      hero: ['headline', 'subheadline', 'ctaLabel'],
      services: ['title', 'intro'],
      team: ['title', 'intro'],
      gallery: ['title'],
      opening_hours: ['title'],
      map_location: ['title'],
      cta_booking: ['headline', 'subtext', 'buttonLabel'],
      rich_text: ['markdown'],
    });
  });

  it('never exposes data-bound content', () => {
    // The failure this guards against is a well-meaning "the service name
    // should be editable too" — it belongs to organization_service.
    const forbidden = [
      ['services', 'categoryNames'],
      ['services', 'showPrices'],
      ['services', 'name'],
      ['team', 'practitionerIds'],
      ['team', 'showBios'],
      ['opening_hours', 'locationId'],
      ['opening_hours', 'showExceptions'],
      ['map_location', 'locationId'],
      ['map_location', 'showAddress'],
      ['gallery', 'assetIds'],
      ['hero', 'imageAssetId'],
      ['hero', 'ctaHref'],
      ['rich_text', 'align'],
    ] as const;
    for (const [type, field] of forbidden) {
      expect(isEditableField(type, field)).toBe(false);
    }
  });

  it('does not make ids or unknown block types editable', () => {
    expect(isEditableField('hero', 'id')).toBe(false);
    expect(isEditableField('testimonials', 'title')).toBe(false);
    expect(isEditableField(undefined, 'title')).toBe(false);
  });
});

describe('editableAttrs', () => {
  it('emits the §3 markup in edit mode', () => {
    expect(editableAttrs(true, 'blk_123', 'hero', 'headline')).toEqual({
      'data-ms-editable': '',
      'data-ms-block': 'blk_123',
      'data-ms-field': 'headline',
      contenteditable: 'plaintext-only',
    });
  });

  it('emits NOTHING when not in edit mode — for every editable field', () => {
    for (const [type, fields] of Object.entries(EDITABLE_FIELDS)) {
      for (const field of fields) {
        expect(editableAttrs(false, 'blk_123', type, field)).toEqual({});
      }
    }
  });

  it('emits nothing for a field that is not editable on that block', () => {
    expect(editableAttrs(true, 'blk_1', 'gallery', 'intro')).toEqual({});
    expect(editableAttrs(true, 'blk_1', 'opening_hours', 'headline')).toEqual(
      {}
    );
  });

  it('emits nothing without a block id — there would be nothing to commit to', () => {
    expect(editableAttrs(true, undefined, 'hero', 'headline')).toEqual({});
    expect(editableAttrs(true, '', 'hero', 'headline')).toEqual({});
  });
});

describe('sanitizeEditableText', () => {
  it('keeps ordinary copy intact', () => {
    expect(sanitizeEditableText('  Glow Clinic  ')).toBe('Glow Clinic');
  });

  it('flattens a single-line field to one line', () => {
    expect(sanitizeEditableText('Glow\nClinic')).toBe('Glow Clinic');
    expect(sanitizeEditableText('Glow \t  Clinic')).toBe('Glow Clinic');
  });

  it('preserves newlines for the multiline markdown field', () => {
    expect(
      sanitizeEditableText('# Title\n\nSome *copy*', { multiline: true })
    ).toBe('# Title\n\nSome *copy*');
  });

  it('strips control characters, bidi overrides and zero-width joiners', () => {
    expect(sanitizeEditableText('Gl\u0000ow\u202EClin\u200Bic')).toBe(
      'GlowClinic'
    );
  });

  it('normalises the non-breaking spaces contenteditable inserts', () => {
    expect(sanitizeEditableText('Glow\u00A0\u00A0Clinic')).toBe('Glow Clinic');
  });

  it('caps the length so a paste cannot balloon the jsonb column', () => {
    expect(sanitizeEditableText('a'.repeat(9_000))).toHaveLength(2_000);
    expect(
      sanitizeEditableText('a'.repeat(50_000), { multiline: true })
    ).toHaveLength(20_000);
  });

  it('does not treat a string of markup as markup — it is only ever text', () => {
    // The renderer commits textContent, so a tag never reaches here as markup.
    // If one somehow does, it stays an inert string: no unescaping, no eval.
    const raw = '<img src=x onerror=alert(1)>';
    expect(sanitizeEditableText(raw)).toBe(raw);
  });

  it('handles null and undefined', () => {
    expect(sanitizeEditableText(null)).toBe('');
    expect(sanitizeEditableText(undefined)).toBe('');
  });
});

describe('hasChanged', () => {
  it('is false for an untouched value — no revision from a focus/blur', () => {
    expect(hasChanged('Glow Clinic', 'Glow Clinic')).toBe(false);
  });

  it('is false when only browser whitespace noise differs', () => {
    expect(hasChanged('Glow Clinic', ' Glow Clinic ')).toBe(false);
  });

  it('is true for a real edit', () => {
    expect(hasChanged('Glow Clinic', 'Glow Clinic Dublin')).toBe(true);
  });

  it('is true when text is deleted entirely', () => {
    expect(hasChanged('Glow Clinic', '')).toBe(true);
  });
});

describe('isTrustedOrigin', () => {
  it('accepts only the exact expected origin', () => {
    expect(
      isTrustedOrigin('https://app.borradh.io', 'https://app.borradh.io')
    ).toBe(true);
  });

  it('rejects look-alike and superstring origins', () => {
    const expected = 'https://app.borradh.io';
    for (const hostile of [
      'https://app.borradh.io.evil.com',
      'https://evil.com',
      'http://app.borradh.io',
      'https://app.borradh.io:8443',
      'https://APP.borradh.io',
    ]) {
      expect(isTrustedOrigin(hostile, expected)).toBe(false);
    }
  });

  it('never trusts a wildcard or an opaque origin', () => {
    expect(isTrustedOrigin('*', 'https://app.borradh.io')).toBe(false);
    expect(isTrustedOrigin('null', 'https://app.borradh.io')).toBe(false);
    expect(isTrustedOrigin('https://app.borradh.io', '*')).toBe(false);
  });

  it('fails CLOSED when the expected origin is missing', () => {
    expect(isTrustedOrigin('https://app.borradh.io', '')).toBe(false);
    expect(isTrustedOrigin('https://app.borradh.io', undefined)).toBe(false);
    expect(isTrustedOrigin(undefined, 'https://app.borradh.io')).toBe(false);
  });
});

describe('toOrigin', () => {
  it('reduces a configured URL to its origin', () => {
    expect(toOrigin('https://app.borradh.io/dashboard/website')).toBe(
      'https://app.borradh.io'
    );
  });

  it('rejects anything that is not an http(s) URL', () => {
    expect(toOrigin('javascript:alert(1)')).toBeNull();
    expect(toOrigin('app.borradh.io')).toBeNull();
    expect(toOrigin('')).toBeNull();
    expect(toOrigin(null)).toBeNull();
  });
});

describe('parseCanvasMessage', () => {
  it('accepts the three §4 canvas messages', () => {
    expect(
      parseCanvasMessage({ source: 'microsite-canvas', type: 'enable-edit' })
    ).toEqual({ source: 'microsite-canvas', type: 'enable-edit' });

    expect(
      parseCanvasMessage({
        source: 'microsite-canvas',
        type: 'commit-ok',
        blockId: 'b1',
        field: 'headline',
      })
    ).toEqual({
      source: 'microsite-canvas',
      type: 'commit-ok',
      blockId: 'b1',
      field: 'headline',
    });

    expect(
      parseCanvasMessage({
        source: 'microsite-canvas',
        type: 'commit-failed',
        blockId: 'b1',
        field: 'headline',
        message: 'nope',
      })
    ).toMatchObject({ type: 'commit-failed', message: 'nope' });
  });

  it('rejects a message from the wrong source or with no shape', () => {
    expect(
      parseCanvasMessage({ source: 'other', type: 'enable-edit' })
    ).toBeNull();
    expect(parseCanvasMessage({ source: 'microsite-canvas' })).toBeNull();
    expect(
      parseCanvasMessage({ source: 'microsite-canvas', type: 'commit-ok' })
    ).toBeNull();
    expect(parseCanvasMessage('enable-edit')).toBeNull();
    expect(parseCanvasMessage(null)).toBeNull();
  });

  it('rejects a non-string message field rather than rendering it', () => {
    const parsed = parseCanvasMessage({
      source: 'microsite-canvas',
      type: 'commit-failed',
      blockId: 'b1',
      field: 'headline',
      message: { toString: () => 'x' },
    });
    expect(parsed).toMatchObject({ type: 'commit-failed' });
    expect((parsed as { message?: string }).message).toBeUndefined();
  });
});
