import { describe, expect, it } from '@borradh-workspace/testing';
import {
  createPageCursor,
  fitImage,
  formatSignedAt,
  interpolatePatientName,
  sanitizePdfText,
  wrapMultiline,
  wrapParagraph,
} from './pdf-layout.js';

/** Deterministic measurer: 10pt per character. */
const measure = (s: string) => s.length * 10;

describe('interpolatePatientName', () => {
  it('substitutes every {{patientName}} with the signer name', () => {
    expect(
      interpolatePatientName(
        'I, {{patientName}}, consent. Signed: {{patientName}}.',
        'Alex Rivers'
      )
    ).toBe('I, Alex Rivers, consent. Signed: Alex Rivers.');
  });

  it('never leaves a raw token in the output', () => {
    expect(
      interpolatePatientName('I, {{patientName}}, agree.', 'Sam')
    ).not.toContain('{{patientName}}');
  });

  it('falls back to a neutral noun for a blank or missing name', () => {
    expect(interpolatePatientName('I, {{patientName}}, agree.', '  ')).toBe(
      'I, the patient, agree.'
    );
    expect(interpolatePatientName('I, {{patientName}}, agree.', null)).toBe(
      'I, the patient, agree.'
    );
    expect(
      interpolatePatientName('I, {{patientName}}, agree.', undefined)
    ).toBe('I, the patient, agree.');
  });

  it('leaves copy without the placeholder untouched', () => {
    expect(interpolatePatientName('Plain consent text.', 'Alex')).toBe(
      'Plain consent text.'
    );
  });
});

describe('sanitizePdfText', () => {
  it('maps typographic characters to WinAnsi-safe ASCII', () => {
    expect(sanitizePdfText('“Don’t” — okay…')).toBe('"Don\'t" - okay...');
  });

  it('drops characters outside Latin-1 (emoji, CJK)', () => {
    expect(sanitizePdfText('ok 👍 漢字 café')).toBe('ok   café');
  });

  it('preserves newlines', () => {
    expect(sanitizePdfText('a\nb')).toBe('a\nb');
  });
});

describe('wrapParagraph', () => {
  it('wraps words to the max width', () => {
    // 10pt/char, width 100 → 10 chars per line.
    expect(wrapParagraph('aaa bbb ccc ddd', 100, measure)).toEqual([
      'aaa bbb',
      'ccc ddd',
    ]);
  });

  it('returns a single line when everything fits', () => {
    expect(wrapParagraph('short', 100, measure)).toEqual(['short']);
  });

  it('hard-breaks a word longer than the line (no zero-progress loop)', () => {
    expect(wrapParagraph('abcdefghijklmnop', 50, measure)).toEqual([
      'abcde',
      'fghij',
      'klmno',
      'p',
    ]);
  });

  it('returns one empty line for empty input', () => {
    expect(wrapParagraph('', 100, measure)).toEqual(['']);
  });
});

describe('wrapMultiline', () => {
  it('respects newlines and keeps blank lines', () => {
    expect(wrapMultiline('aaa bbb ccc\n\nddd', 100, measure)).toEqual([
      'aaa bbb',
      'ccc',
      '',
      'ddd',
    ]);
  });
});

describe('fitImage', () => {
  it('scales down preserving aspect ratio', () => {
    expect(fitImage(360, 120, 180, 60)).toEqual({ width: 180, height: 60 });
    expect(fitImage(600, 100, 180, 60)).toEqual({ width: 180, height: 30 });
  });

  it('never scales up', () => {
    expect(fitImage(90, 30, 180, 60)).toEqual({ width: 90, height: 30 });
  });

  it('is safe on degenerate dimensions', () => {
    expect(fitImage(0, 0, 180, 60)).toEqual({ width: 0, height: 0 });
  });
});

describe('formatSignedAt', () => {
  const date = new Date('2026-08-11T14:30:00.000Z');

  it('formats in the org timezone', () => {
    // Europe/Dublin is UTC+1 in August.
    expect(formatSignedAt(date, 'Europe/Dublin')).toContain('15:30');
    expect(formatSignedAt(date, 'Europe/Dublin')).toContain('11 August 2026');
  });

  it('falls back to UTC on an invalid timezone', () => {
    expect(formatSignedAt(date, 'Not/AZone')).toContain('14:30');
  });
});

describe('createPageCursor', () => {
  const make = () =>
    createPageCursor({ pageHeight: 200, marginTop: 20, marginBottom: 20 });

  it('advances down the page from the top margin', () => {
    const cursor = make();
    const first = cursor.take(50);
    expect(first).toMatchObject({ pageIndex: 0, y: 180, newPage: false });
    const second = cursor.take(50);
    expect(second).toMatchObject({ pageIndex: 0, y: 130, newPage: false });
  });

  it('opens a new page when a block will not fit', () => {
    const cursor = make();
    cursor.take(150); // y → 30; only 10 usable left
    const overflow = cursor.take(50);
    expect(overflow).toMatchObject({ pageIndex: 1, y: 180, newPage: true });
  });

  it('does not open a page for a block taller than a full page at the top', () => {
    const cursor = make();
    const huge = cursor.take(500);
    expect(huge.pageIndex).toBe(0);
    expect(huge.newPage).toBe(false);
  });

  it('drops gaps at a page top', () => {
    const cursor = make();
    cursor.gap(30);
    expect(cursor.position).toEqual({ pageIndex: 0, y: 180 });
    cursor.take(10);
    cursor.gap(30);
    expect(cursor.position).toEqual({ pageIndex: 0, y: 140 });
  });
});
