import { describe, expect, it } from 'vitest';
import {
  buildRows,
  mapHeadersHeuristically,
  normalizeHeader,
} from './map-columns.js';

describe('normalizeHeader', () => {
  it('lower-cases, unifies separators and strips punctuation', () => {
    expect(normalizeHeader(' First_Name ')).toBe('first name');
    expect(normalizeHeader('E-Mail (work)')).toBe('e mail work');
    expect(normalizeHeader('﻿Name')).toBe('name');
  });
});

describe('mapHeadersHeuristically', () => {
  it('maps common header synonyms', () => {
    expect(
      mapHeadersHeuristically([
        'First Name',
        'Surname',
        'E-mail',
        'Mobile',
        'WhatsApp',
        'Lead Source',
        'Tags',
        'Comments',
      ])
    ).toEqual([
      'firstName',
      'lastName',
      'email',
      'phone',
      'whatsapp',
      'source',
      'tags',
      'notes',
    ]);
  });

  it('maps a bare "Name" column to fullName', () => {
    expect(mapHeadersHeuristically(['Name', 'Email'])).toEqual([
      'fullName',
      'email',
    ]);
  });

  it('uses contains-hints for decorated headers', () => {
    expect(mapHeadersHeuristically(['Work Email', 'Phone 2'])).toEqual([
      'email',
      'phone',
    ]);
  });

  it('gives single-slot fields to the first column only', () => {
    expect(mapHeadersHeuristically(['Email', 'Email 2'])).toEqual([
      'email',
      null,
    ]);
  });

  it('returns null for unknown headers', () => {
    expect(mapHeadersHeuristically(['Vorname', 'Custom Field'])).toEqual([
      null,
      null,
    ]);
  });
});

describe('buildRows', () => {
  it('splits full names and keeps unmapped columns as note lines', () => {
    const headers = ['Name', 'Email', 'Company'];
    const { rows, skippedRows } = buildRows(
      headers,
      ['fullName', 'email', null],
      [["Mary Jane O'Brien", 'MARY@Example.ie', 'Acme Clinic']]
    );
    expect(skippedRows).toBe(0);
    expect(rows).toEqual([
      {
        firstName: 'Mary',
        lastName: "Jane O'Brien",
        email: 'mary@example.ie',
        notes: 'Company: Acme Clinic',
      },
    ]);
  });

  it('demotes invalid emails to notes and keeps the row via phone', () => {
    const { rows } = buildRows(
      ['Email', 'Phone'],
      ['email', 'phone'],
      [['not-an-email', '087 684 6467']]
    );
    expect(rows).toEqual([
      { phone: '087 684 6467', notes: 'Email: not-an-email' },
    ]);
  });

  it('coerces source aliases onto the enum and demotes unknowns', () => {
    const { rows } = buildRows(
      ['Name', 'Source'],
      ['fullName', 'source'],
      [
        ['Ana', 'IG'],
        ['Bea', 'Billboard'],
      ]
    );
    expect(rows[0].source).toBe('instagram');
    expect(rows[1].source).toBeUndefined();
    expect(rows[1].notes).toBe('Source: Billboard');
  });

  it('splits and dedupes tags', () => {
    const { rows } = buildRows(
      ['Name', 'Tags'],
      ['fullName', 'tags'],
      [['Ana', 'botox; filler,botox']]
    );
    expect(rows[0].tags).toEqual(['botox', 'filler']);
  });

  it('skips rows with no name and no contact detail', () => {
    const { rows, skippedRows } = buildRows(
      ['Name', 'Email', 'Notes'],
      ['fullName', 'email', 'notes'],
      [
        ['', '', 'totals: 41'],
        ['Ana', 'ana@example.ie', ''],
      ]
    );
    expect(rows).toHaveLength(1);
    expect(skippedRows).toBe(1);
  });
});
