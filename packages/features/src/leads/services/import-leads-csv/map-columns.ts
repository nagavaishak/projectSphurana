import { leadSourceValues } from '@borradh-workspace/labels';
import type { ImportLeadRow } from '../import-leads/import-leads.schema.js';

/**
 * Header → lead-field mapping and row building for the spreadsheet import.
 *
 * Deterministic first: normalized header names are matched against a synonym
 * table. Whatever the heuristics can't place may be filled in by a single
 * optional AI call (see the service); columns that still map to nothing are
 * preserved as "Header: value" lines in `notes`, so no data is dropped.
 */

export const MAPPABLE_FIELDS = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'whatsapp',
  'source',
  'tags',
  'notes',
  'ignore',
] as const;

export type MappableField = (typeof MAPPABLE_FIELDS)[number];

/** lower-case, de-BOM, unify separators, strip punctuation, collapse spaces */
export function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/[_\-./:()[\]]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADER_SYNONYMS: Record<string, MappableField> = {
  // firstName
  'first name': 'firstName',
  firstname: 'firstName',
  first: 'firstName',
  forename: 'firstName',
  'given name': 'firstName',
  fname: 'firstName',
  // lastName
  'last name': 'lastName',
  lastname: 'lastName',
  last: 'lastName',
  surname: 'lastName',
  'family name': 'lastName',
  'second name': 'lastName',
  lname: 'lastName',
  // fullName (split into first/last when building rows)
  name: 'fullName',
  'full name': 'fullName',
  fullname: 'fullName',
  client: 'fullName',
  'client name': 'fullName',
  customer: 'fullName',
  'customer name': 'fullName',
  contact: 'fullName',
  'contact name': 'fullName',
  'lead name': 'fullName',
  patient: 'fullName',
  'patient name': 'fullName',
  // email
  email: 'email',
  'e mail': 'email',
  'email address': 'email',
  'e mail address': 'email',
  mail: 'email',
  // phone
  phone: 'phone',
  'phone number': 'phone',
  'phone no': 'phone',
  mobile: 'phone',
  'mobile number': 'phone',
  'mobile no': 'phone',
  mob: 'phone',
  tel: 'phone',
  telephone: 'phone',
  cell: 'phone',
  'cell phone': 'phone',
  'contact number': 'phone',
  number: 'phone',
  // whatsapp
  whatsapp: 'whatsapp',
  'whats app': 'whatsapp',
  'whatsapp number': 'whatsapp',
  wa: 'whatsapp',
  // source
  source: 'source',
  'lead source': 'source',
  channel: 'source',
  origin: 'source',
  'how did you hear': 'source',
  'found us': 'source',
  // tags
  tags: 'tags',
  tag: 'tags',
  labels: 'tags',
  label: 'tags',
  category: 'tags',
  categories: 'tags',
  interests: 'tags',
  segment: 'tags',
  // notes
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
  comment: 'notes',
  remarks: 'notes',
  description: 'notes',
  message: 'notes',
  details: 'notes',
  'additional info': 'notes',
};

/** Looser contains-matching for headers like "Work email" or "Phone 2". */
const CONTAINS_HINTS: [string, MappableField][] = [
  ['whatsapp', 'whatsapp'],
  ['email', 'email'],
  ['e mail', 'email'],
  ['phone', 'phone'],
  ['mobile', 'phone'],
  ['first name', 'firstName'],
  ['last name', 'lastName'],
  ['surname', 'lastName'],
  ['full name', 'fullName'],
  ['note', 'notes'],
  ['comment', 'notes'],
];

/**
 * Map each header to a lead field, or null when unknown. Contact/name fields
 * are single-slot (first matching column wins; later duplicates fall through
 * to notes); `tags`/`notes` may be fed by several columns.
 */
export function mapHeadersHeuristically(
  headers: string[]
): (MappableField | null)[] {
  const taken = new Set<MappableField>();
  const claim = (field: MappableField): MappableField | null => {
    if (field === 'notes' || field === 'tags' || field === 'ignore') {
      return field;
    }
    if (taken.has(field)) return null;
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SOURCE_ALIASES: Record<string, (typeof leadSourceValues)[number]> = {
  ig: 'instagram',
  insta: 'instagram',
  fb: 'facebook',
  meta: 'facebook',
  wa: 'whatsapp',
  web: 'website',
  site: 'website',
  online: 'website',
  referred: 'referral',
  'word of mouth': 'referral',
  recommendation: 'referral',
};

function coerceSource(
  value: string
): (typeof leadSourceValues)[number] | undefined {
  const normalized = normalizeHeader(value);
  if ((leadSourceValues as readonly string[]).includes(normalized)) {
    return normalized as (typeof leadSourceValues)[number];
  }
  return SOURCE_ALIASES[normalized];
}

function splitTags(value: string): string[] {
  return value
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 100)
    .slice(0, 20);
}

/**
 * "Mary Jane O'Brien" → { firstName: "Mary", lastName: "Jane O'Brien" };
 * "O'Brien, Mary" (Last, First exports) → { firstName: "Mary", lastName: "O'Brien" }
 */
function splitFullName(value: string): {
  firstName?: string;
  lastName?: string;
} {
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return {};
  const commaIdx = cleaned.indexOf(',');
  if (commaIdx !== -1) {
    const last = cleaned.slice(0, commaIdx).trim();
    const first = cleaned.slice(commaIdx + 1).trim();
    if (first && last) return { firstName: first, lastName: last };
  }
  const spaceIdx = cleaned.indexOf(' ');
  if (spaceIdx === -1) return { firstName: cleaned };
  return {
    firstName: cleaned.slice(0, spaceIdx),
    lastName: cleaned.slice(spaceIdx + 1),
  };
}

const MAX_NOTES_CHARS = 2_000;
const MAX_NAME_CHARS = 200;
const MAX_PHONE_CHARS = 30;

/**
 * Row under construction — like ImportLeadRow but with `source` optional
 * (the schema's `.default('manual')` applies when the file names none).
 */
export type LeadRowDraft = Partial<ImportLeadRow>;

export interface BuiltRows {
  rows: LeadRowDraft[];
  /** Data rows dropped because they had no name and no contact detail. */
  skippedRows: number;
}

/**
 * Turn the data matrix into ImportLeadRows using the header mapping. Values
 * that fail light validation (bad email, absurdly long phone) are demoted to
 * notes rather than dropped, and unmapped columns are appended to notes too —
 * the import keeps whatever data the file had.
 */
export function buildRows(
  headers: string[],
  mapping: (MappableField | null)[],
  dataRows: string[][]
): BuiltRows {
  const rows: LeadRowDraft[] = [];
  let skippedRows = 0;

  for (const cells of dataRows) {
    const row: LeadRowDraft = {};
    const extraNotes: string[] = [];
    const tags: string[] = [];

    for (let col = 0; col < headers.length; col++) {
      const value = (cells[col] ?? '').trim();
      if (!value) continue;
      const field = mapping[col];

      switch (field) {
        case 'ignore':
          break;
        case 'firstName':
          row.firstName ??= value.slice(0, MAX_NAME_CHARS);
          break;
        case 'lastName':
          row.lastName ??= value.slice(0, MAX_NAME_CHARS);
          break;
        case 'fullName': {
          const { firstName, lastName } = splitFullName(value);
          if (firstName) row.firstName ??= firstName.slice(0, MAX_NAME_CHARS);
          if (lastName) row.lastName ??= lastName.slice(0, MAX_NAME_CHARS);
          break;
        }
        case 'email': {
          const email = value.toLowerCase();
          if (EMAIL_RE.test(email) && !row.email) row.email = email;
          else extraNotes.push(`${headers[col].trim()}: ${value}`);
          break;
        }
        case 'phone':
        case 'whatsapp': {
          if (value.length <= MAX_PHONE_CHARS && !row[field]) {
            row[field] = value;
          } else {
            extraNotes.push(`${headers[col].trim()}: ${value}`);
          }
          break;
        }
        case 'source': {
          const source = coerceSource(value);
          if (source) row.source ??= source;
          else extraNotes.push(`${headers[col].trim()}: ${value}`);
          break;
        }
        case 'tags':
          tags.push(...splitTags(value));
          break;
        case 'notes':
          extraNotes.unshift(value);
          break;
        default:
          // Unmapped column — keep the data as a labelled note line.
          extraNotes.push(
            `${(headers[col] ?? '').trim() || 'Column'}: ${value}`
          );
      }
    }

    if (tags.length > 0) row.tags = [...new Set(tags)].slice(0, 20);
    if (extraNotes.length > 0) {
      row.notes = extraNotes.join('\n').slice(0, MAX_NOTES_CHARS);
    }

    // A lead we can neither address nor contact is noise, not data.
    if (!row.firstName && !row.email && !row.phone && !row.whatsapp) {
      skippedRows++;
      continue;
    }
    rows.push(row);
  }

  return { rows, skippedRows };
}
