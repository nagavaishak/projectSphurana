/**
 * Header → service-field mapping and row building for the catalogue import.
 *
 * Mirrors the leads importer's shape deliberately (synonym table first, one
 * optional AI call for the leftovers, unmapped columns preserved as note
 * lines) — see `leads/services/import-leads-csv/map-columns.ts`. What differs
 * is the vocabulary: a salon's export names things like "Service", "Treatment
 * name", "Duration (mins)", "Price incl. VAT".
 *
 * The two value coercions here are the ones that actually decide whether an
 * import is usable: PRICE, which arrives as "€85", "From £50", "1.250,00" or
 * "POA", and DURATION, which arrives as "60", "1h 30m" or "1:30".
 */

/** The fields a spreadsheet column can be resolved to. */
export const MAPPABLE_SERVICE_FIELDS = [
  'name',
  'description',
  'category',
  'price',
  'duration',
  'notes',
  'ignore',
] as const;

export type MappableServiceField = (typeof MAPPABLE_SERVICE_FIELDS)[number];

/** lower-case, de-BOM, unify separators, strip punctuation, collapse spaces */
export function normalizeHeader(header: string): string {
  return header
    .replace(/^﻿/, '')
    .toLowerCase()
    .replace(/[_\-./:()[\]]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_SYNONYMS: Record<string, MappableServiceField> = {
  // name
  name: 'name',
  service: 'name',
  'service name': 'name',
  'service title': 'name',
  treatment: 'name',
  'treatment name': 'name',
  title: 'name',
  item: 'name',
  'item name': 'name',
  procedure: 'name',
  'procedure name': 'name',
  offering: 'name',
  // description
  description: 'description',
  desc: 'description',
  'service description': 'description',
  details: 'description',
  about: 'description',
  summary: 'description',
  // category
  category: 'category',
  categories: 'category',
  'service category': 'category',
  'category name': 'category',
  group: 'category',
  'service group': 'category',
  type: 'category',
  'service type': 'category',
  department: 'category',
  section: 'category',
  // price
  price: 'price',
  cost: 'price',
  amount: 'price',
  rate: 'price',
  fee: 'price',
  charge: 'price',
  'service price': 'price',
  'retail price': 'price',
  'list price': 'price',
  'price incl vat': 'price',
  'price inc vat': 'price',
  'gross price': 'price',
  // duration
  duration: 'duration',
  'duration mins': 'duration',
  'duration minutes': 'duration',
  time: 'duration',
  length: 'duration',
  mins: 'duration',
  minutes: 'duration',
  'appointment duration': 'duration',
  'appointment length': 'duration',
  'treatment time': 'duration',
  'service duration': 'duration',
  // notes
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
  comment: 'notes',
  remarks: 'notes',
};

/** Looser contains-matching for headers like "Price (EUR)" or "Duration in minutes". */
const CONTAINS_HINTS: [string, MappableServiceField][] = [
  ['service name', 'name'],
  ['treatment name', 'name'],
  ['description', 'description'],
  ['category', 'category'],
  ['duration', 'duration'],
  ['minute', 'duration'],
  ['price', 'price'],
  ['cost', 'price'],
  ['note', 'notes'],
];

/**
 * Map each header to a service field, or null when unknown.
 *
 * Every field except `notes`/`ignore` is single-slot: the FIRST matching column
 * wins and later duplicates fall through to notes. That matters more here than
 * it does for leads, because catalogue exports routinely carry several price
 * columns ("Price", "Member price", "Price ex VAT") and silently letting the
 * last one win would reprice the whole catalogue.
 *
 * A duplicate resolves to `notes`, NOT to null. The difference is the whole
 * ballgame: null means "unresolved", unresolved columns are handed to the
 * model, and a model asked to place a second price column when `price` is
 * already taken quite reasonably answers `ignore` — which DELETES it. We are
 * not unsure what "Member price" holds; we know exactly what it holds and have
 * nowhere to put it. That is a notes column, and the model should never be
 * asked about it. (Before this, `['Price', 'Member price', 'Price ex VAT']`
 * imported as one price and two silently dropped columns.)
 */
export function mapServiceHeadersHeuristically(
  headers: string[]
): (MappableServiceField | null)[] {
  const taken = new Set<MappableServiceField>();
  const claim = (field: MappableServiceField): MappableServiceField | null => {
    if (field === 'notes' || field === 'ignore') return field;
    if (taken.has(field)) return 'notes';
    taken.add(field);
    return field;
  };

  return headers.map((header) => {
    const normalized = normalizeHeader(header);
    if (!normalized) return null;
    const exact = HEADER_SYNONYMS[normalized];
    if (exact) return claim(exact);
    for (const [hint, field] of CONTAINS_HINTS) {
      if (normalized.includes(hint)) return claim(field);
    }
    return null;
  });
}

// ── value coercion ──────────────────────────────────────────────────────

/** What a price cell resolved to. `poa` means "we could not read a number". */
export interface ParsedPrice {
  priceType: 'fixed' | 'from' | 'free' | 'poa';
  priceCents: number | null;
}

const FREE_WORDS = /^(free|no charge|complimentary|included|n\/?a)$/i;
const POA_WORDS =
  /^(poa|p\.o\.a\.?|on request|price on request|on application|tbc|tbd|varies|quote|consultation)$/i;

/** Highest price we will believe from a spreadsheet cell (€100,000). */
const MAX_PRICE_CENTS = 10_000_000;

/**
 * Turn a numeric string into cents, resolving the decimal separator without
 * guessing at a locale.
 *
 * The ambiguity is real: "1,250" is €1250 to an Irish salon and €1.25 to a
 * German one. The rule used here is positional, not regional — whichever of
 * `.` or `,` appears LAST is the decimal point, and a lone separator counts as
 * a decimal point only when exactly two digits follow it. So "1.250,00" → 125000,
 * "1,250.00" → 125000, "85,50" → 8550 and "1,250" → 125000.
 */
function digitsToCents(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;

  const lastDot = cleaned.lastIndexOf('.');
  const lastComma = cleaned.lastIndexOf(',');
  const sepIdx = Math.max(lastDot, lastComma);

  let whole = cleaned;
  let fraction = '';
  if (sepIdx !== -1) {
    const tail = cleaned.slice(sepIdx + 1);
    const isDecimal =
      // Both separators present: the last one is the decimal point.
      (lastDot !== -1 && lastComma !== -1) ||
      // A lone separator is a decimal point only with exactly 2 digits after.
      tail.length === 2;
    if (isDecimal && /^\d+$/.test(tail)) {
      whole = cleaned.slice(0, sepIdx);
      fraction = tail;
    }
  }

  const wholeDigits = whole.replace(/[^\d]/g, '');
  if (!wholeDigits && !fraction) return null;
  const cents =
    Number(wholeDigits || '0') * 100 + Number(fraction.padEnd(2, '0') || '0');
  if (!Number.isFinite(cents) || cents < 0 || cents > MAX_PRICE_CENTS) {
    return null;
  }
  return Math.round(cents);
}

/**
 * "€85" → fixed 8500 · "From £50" → from 5000 · "Free" → free ·
 * "POA" → poa · "€50–€80" → from 5000 (a range's floor is its "from").
 *
 * Returns null when the cell holds no price information at all, so the caller
 * can keep the raw text as a note instead of inventing a price.
 */
export function parsePrice(value: string): ParsedPrice | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (FREE_WORDS.test(trimmed)) return { priceType: 'free', priceCents: null };
  if (POA_WORDS.test(trimmed)) return { priceType: 'poa', priceCents: null };

  // "From €50", "Starting at 50", "50+" all anchor a range at its floor.
  const isFrom =
    /^(from|starting(\s+(at|from))?|starts\s+at)\b/i.test(trimmed) ||
    /\+\s*$/.test(trimmed) ||
    // A range: take the low end and call it "from". The `[^\d\s]{0,2}` hop
    // is the currency symbol that usually repeats on the high end ("€50–€80").
    /\d\s*(?:-|–|—|\bto\b)\s*[^\d\s]{0,2}\s*\d/i.test(trimmed);

  const cents = digitsToCents(
    // A range's floor is the first number, so cut at the separator first.
    trimmed.split(/\s*(?:-|–|—|\bto\b)\s*/i)[0] ?? trimmed
  );
  if (cents === null) return null;
  // An explicit zero is free, not a €0 fixed price.
  if (cents === 0) return { priceType: 'free', priceCents: null };

  return { priceType: isFrom ? 'from' : 'fixed', priceCents: cents };
}

/** Bounds from `createServiceRequestBase.appointmentDuration`. */
const MIN_DURATION = 5;
const MAX_DURATION = 480;

/**
 * "60" · "60 min" · "90 minutes" · "1h" · "1h 30m" · "1:30" · "1.5 hours"
 * → minutes, clamped to the 5–480 the service schema accepts.
 *
 * Returns null for anything unreadable, and for durations OUTSIDE the range
 * rather than clamping them: a "1440" cell means the column is not minutes,
 * and a silently-clamped 480 would be a wrong appointment length rather than
 * an obviously missing one.
 */
export function parseDuration(value: string): number | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  let minutes: number | null = null;

  // "1:30" / "01:30:00"
  const clock = trimmed.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (clock) {
    minutes = Number(clock[1]) * 60 + Number(clock[2]);
  }

  // "1h 30m", "1 hr 30 min", "2h"
  if (minutes === null) {
    const hm = trimmed.match(
      /^(\d+(?:[.,]\d+)?)\s*(?:h|hr|hrs|hour|hours)\b(?:\s*(\d+)\s*(?:m|min|mins|minute|minutes)?\b)?/
    );
    if (hm) {
      const hours = Number(hm[1].replace(',', '.'));
      minutes = Math.round(hours * 60) + Number(hm[2] ?? 0);
    }
  }

  // "90", "90 min", "90 minutes"
  if (minutes === null) {
    const plain = trimmed.match(
      /^(\d+(?:[.,]\d+)?)\s*(?:m|min|mins|minute|minutes)?$/
    );
    if (plain) minutes = Math.round(Number(plain[1].replace(',', '.')));
  }

  if (minutes === null || !Number.isFinite(minutes)) return null;
  if (minutes < MIN_DURATION || minutes > MAX_DURATION) return null;
  return minutes;
}

// ── row building ────────────────────────────────────────────────────────

const MAX_NAME_CHARS = 100; // createServiceRequestBase.name
const MAX_DESCRIPTION_CHARS = 500; // createServiceRequestBase.description
const MAX_CATEGORY_CHARS = 100;

/**
 * One service the file describes, in the shape `createService` wants — except
 * `categoryName`, which the service resolves to a `categoryId` against the
 * org's own categories.
 */
export interface ServiceRowDraft {
  name: string;
  description?: string;
  categoryName?: string;
  priceType?: 'fixed' | 'from' | 'free' | 'poa';
  priceCents?: number | null;
  appointmentDuration?: number | null;
}

export interface BuiltServiceRows {
  rows: ServiceRowDraft[];
  /** Data rows dropped because they had no service name. */
  skippedRows: number;
}

/**
 * Turn the data matrix into service drafts using the header mapping.
 *
 * Values that fail coercion (a price cell reading "ask reception", a duration
 * of "all day") are demoted to the description rather than dropped, and so are
 * unmapped columns — the import keeps whatever the file had, and the clinic can
 * see it on the service afterwards.
 */
/**
 * Headers that ARE the notes column. Their content is already free text about
 * the service, so a "Notes: " prefix would only add noise.
 */
const GENERIC_NOTES_HEADERS = new Set([
  'notes',
  'note',
  'comments',
  'comment',
  'remarks',
]);

/**
 * A line for the description, labelled with its source header unless the
 * header is a plain notes column.
 *
 * Everything that reaches the description arrived because we could not store
 * it properly, so the clinic has to be able to READ it afterwards and put it
 * where it belongs. A bare "20 mins" or "€90" sitting in a description tells
 * them nothing about which column it fell out of; "Room turnaround: 20 mins"
 * tells them everything.
 */
function noteLine(header: string, value: string): string {
  return GENERIC_NOTES_HEADERS.has(normalizeHeader(header))
    ? value
    : `${header}: ${value}`;
}

export function buildServiceRows(
  headers: string[],
  mapping: (MappableServiceField | null)[],
  dataRows: string[][]
): BuiltServiceRows {
  const rows: ServiceRowDraft[] = [];
  let skippedRows = 0;

  for (const cells of dataRows) {
    let name: string | undefined;
    const draft: Omit<ServiceRowDraft, 'name'> = {};
    const extraNotes: string[] = [];

    for (let col = 0; col < headers.length; col++) {
      const value = (cells[col] ?? '').trim();
      if (!value) continue;
      const field = mapping[col];
      const header = (headers[col] ?? '').trim() || 'Column';

      switch (field) {
        case 'ignore':
          break;
        case 'name':
          name ??= value.slice(0, MAX_NAME_CHARS);
          break;
        case 'description':
          // The description column leads; notes and stray columns follow it.
          extraNotes.unshift(value);
          break;
        case 'category':
          draft.categoryName ??= value.slice(0, MAX_CATEGORY_CHARS);
          break;
        case 'price': {
          const price = parsePrice(value);
          if (price && draft.priceType === undefined) {
            draft.priceType = price.priceType;
            draft.priceCents = price.priceCents;
          } else if (!price) {
            extraNotes.push(`${header}: ${value}`);
          }
          break;
        }
        case 'duration': {
          const minutes = parseDuration(value);
          if (minutes !== null && draft.appointmentDuration == null) {
            draft.appointmentDuration = minutes;
          } else if (minutes === null) {
            extraNotes.push(`${header}: ${value}`);
          }
          break;
        }
        case 'notes':
          extraNotes.push(noteLine(header, value));
          break;
        default:
          // Unmapped column — keep the data as a labelled note line.
          extraNotes.push(`${header}: ${value}`);
      }
    }

    // A service with no name is not a service. Unlike a lead, there is no
    // second identifying field to fall back to.
    if (!name) {
      skippedRows++;
      continue;
    }

    if (extraNotes.length > 0) {
      draft.description = extraNotes.join('\n').slice(0, MAX_DESCRIPTION_CHARS);
    }

    rows.push({ name, ...draft });
  }

  return { rows, skippedRows };
}
