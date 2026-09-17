import { describe, expect, it } from 'vitest';
import {
  buildServiceRows,
  mapServiceHeadersHeuristically,
  normalizeHeader,
  parseDuration,
  parsePrice,
} from './map-service-columns.js';

describe('normalizeHeader', () => {
  it('lower-cases, unifies separators and strips punctuation', () => {
    expect(normalizeHeader(' Service_Name ')).toBe('service name');
    expect(normalizeHeader('Price (incl. VAT)')).toBe('price incl vat');
    expect(normalizeHeader('﻿Service')).toBe('service');
  });
});

describe('mapServiceHeadersHeuristically', () => {
  it('maps common catalogue header synonyms', () => {
    expect(
      mapServiceHeadersHeuristically([
        'Service Name',
        'Description',
        'Category',
        'Price',
        'Duration',
        'Notes',
      ])
    ).toEqual([
      'name',
      'description',
      'category',
      'price',
      'duration',
      'notes',
    ]);
  });

  it('falls back to contains-matching for decorated headers', () => {
    expect(
      mapServiceHeadersHeuristically(['Price (EUR)', 'Duration in minutes'])
    ).toEqual(['price', 'duration']);
  });

  it('gives a single-slot field to the FIRST column only, and the rest to notes', () => {
    // A second price column must not silently reprice the catalogue — but it
    // must not be DROPPED either, and it must not be sent to the model as if
    // we were unsure what it was. `null` here used to mean "unresolved", which
    // handed "Member price" to the AI assist, which answered `ignore`, which
    // deleted the column. We know exactly what these hold; we just have
    // nowhere to put them. That is notes.
    expect(
      mapServiceHeadersHeuristically(['Price', 'Member price', 'Price ex VAT'])
    ).toEqual(['price', 'notes', 'notes']);
  });

  it('sends a duplicate single-slot column to notes for every field, not just price', () => {
    expect(
      mapServiceHeadersHeuristically([
        'Service name',
        'Treatment name',
        'Duration',
        'Treatment time',
        'Category',
        'Department',
      ])
    ).toEqual(['name', 'notes', 'duration', 'notes', 'category', 'notes']);
  });

  it('lets several columns feed notes', () => {
    expect(mapServiceHeadersHeuristically(['Notes', 'Comments'])).toEqual([
      'notes',
      'notes',
    ]);
  });

  it('returns null for headers it does not recognise', () => {
    expect(mapServiceHeadersHeuristically(['Xyzzy', ''])).toEqual([null, null]);
  });
});

describe('parsePrice', () => {
  it('reads a plain fixed price with or without a currency symbol', () => {
    expect(parsePrice('85')).toEqual({ priceType: 'fixed', priceCents: 8500 });
    expect(parsePrice('€85')).toEqual({ priceType: 'fixed', priceCents: 8500 });
    expect(parsePrice(' £85.50 ')).toEqual({
      priceType: 'fixed',
      priceCents: 8550,
    });
  });

  it('resolves the decimal separator positionally, not by locale', () => {
    expect(parsePrice('1,250.00')?.priceCents).toBe(125_000);
    expect(parsePrice('1.250,00')?.priceCents).toBe(125_000);
    // A lone separator with exactly two digits after it is a decimal point…
    expect(parsePrice('85,50')?.priceCents).toBe(8550);
    // …and otherwise a thousands separator.
    expect(parsePrice('1,250')?.priceCents).toBe(125_000);
  });

  it('treats "from", a trailing plus and a range as a from-price', () => {
    expect(parsePrice('From €50')).toEqual({
      priceType: 'from',
      priceCents: 5000,
    });
    expect(parsePrice('Starting at 50')).toEqual({
      priceType: 'from',
      priceCents: 5000,
    });
    expect(parsePrice('50+')).toEqual({ priceType: 'from', priceCents: 5000 });
    // A range anchors at its floor.
    expect(parsePrice('€50–€80')).toEqual({
      priceType: 'from',
      priceCents: 5000,
    });
  });

  it('recognises free and price-on-application wording', () => {
    for (const free of ['Free', 'no charge', 'Complimentary']) {
      expect(parsePrice(free)).toEqual({ priceType: 'free', priceCents: null });
    }
    for (const poa of ['POA', 'On request', 'TBC', 'Varies']) {
      expect(parsePrice(poa)).toEqual({ priceType: 'poa', priceCents: null });
    }
    // An explicit zero is free, not a €0 fixed price.
    expect(parsePrice('0')).toEqual({ priceType: 'free', priceCents: null });
  });

  it('returns null for a cell holding no price at all', () => {
    expect(parsePrice('')).toBeNull();
    expect(parsePrice('ask reception')).toBeNull();
  });

  it('rejects an absurd number rather than storing it', () => {
    expect(parsePrice('999999999')).toBeNull();
  });
});

describe('parseDuration', () => {
  it('reads plain minutes with or without a unit', () => {
    expect(parseDuration('60')).toBe(60);
    expect(parseDuration('60 min')).toBe(60);
    expect(parseDuration('90 minutes')).toBe(90);
  });

  it('reads hours and hour/minute combinations', () => {
    expect(parseDuration('1h')).toBe(60);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1 hr 30 min')).toBe(90);
    expect(parseDuration('1.5 hours')).toBe(90);
  });

  it('reads clock notation', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('00:45')).toBe(45);
  });

  it('returns null outside the 5–480 the service schema accepts', () => {
    // "1440" means the column is not minutes; clamping would invent a length.
    expect(parseDuration('1440')).toBeNull();
    expect(parseDuration('2')).toBeNull();
  });

  it('returns null for unreadable cells', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('all day')).toBeNull();
  });
});

describe('buildServiceRows', () => {
  const headers = ['Service', 'Category', 'Price', 'Duration'];
  const mapping = ['name', 'category', 'price', 'duration'] as const;

  it('builds a service from a mapped row', () => {
    const { rows, skippedRows } = buildServiceRows(
      headers,
      [...mapping],
      [['Deluxe Facial', 'Facials', 'From €80', '1h 15m']]
    );
    expect(skippedRows).toBe(0);
    expect(rows).toEqual([
      {
        name: 'Deluxe Facial',
        categoryName: 'Facials',
        priceType: 'from',
        priceCents: 8000,
        appointmentDuration: 75,
      },
    ]);
  });

  it('drops a row with no service name and counts it', () => {
    const { rows, skippedRows } = buildServiceRows(
      headers,
      [...mapping],
      [['', 'Facials', '€80', '60']]
    );
    expect(rows).toEqual([]);
    expect(skippedRows).toBe(1);
  });

  it('demotes an unreadable price or duration to the description', () => {
    const { rows } = buildServiceRows(
      headers,
      [...mapping],
      [['Massage', 'Body', 'ask reception', 'all day']]
    );
    expect(rows[0].priceType).toBeUndefined();
    expect(rows[0].appointmentDuration).toBeUndefined();
    expect(rows[0].description).toBe('Price: ask reception\nDuration: all day');
  });

  it('preserves unmapped columns as labelled description lines', () => {
    const { rows } = buildServiceRows(
      ['Service', 'Aftercare'],
      ['name', null],
      [['Peel', 'Avoid sun for 48h']]
    );
    expect(rows[0].description).toBe('Aftercare: Avoid sun for 48h');
  });

  it('puts the description column first and appends the rest after it', () => {
    const { rows } = buildServiceRows(
      ['Service', 'Description', 'Aftercare'],
      ['name', 'description', null],
      [['Peel', 'A gentle exfoliation.', 'Avoid sun']]
    );
    expect(rows[0].description).toBe(
      'A gentle exfoliation.\nAftercare: Avoid sun'
    );
  });

  it('skips ignored columns entirely', () => {
    const { rows } = buildServiceRows(
      ['Service', 'Internal ID'],
      ['name', 'ignore'],
      [['Peel', 'SVC-0001']]
    );
    expect(rows[0].description).toBeUndefined();
  });
});
