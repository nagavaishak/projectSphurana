import { appointment, lead } from '@borradh-workspace/database';
import {
  type AnyColumn,
  type SQL,
  and,
  desc,
  eq,
  inArray,
  or,
  sql,
} from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';
import type { LeadCandidate } from '../../models/index.js';

const MAX_CANDIDATES = 10;
const MAX_ROWS = 25;
const MIN_PHONE_DIGITS = 7;
const PHONE_SUFFIX_DIGITS = 9;
const MAX_NAME_TOKENS = 4;
const APPOINTMENTS_PER_CANDIDATE = 3;

export interface FindLeadCandidatesInput {
  organizationId: string;
  personName: string | null;
  email: string | null;
  phone: string | null;
}

const digitsOf = (value: string | null | undefined): string =>
  (value ?? '').replace(/\D/g, '');

/** Last 9 digits — survives +44 / 0 / spaces / brackets differences. */
export const phoneSuffix = (
  value: string | null | undefined
): string | null => {
  const digits = digitsOf(value);
  if (digits.length < MIN_PHONE_DIGITS) return null;
  return digits.slice(-PHONE_SUFFIX_DIGITS);
};

/**
 * Accents and punctuation folded away, so "O'Súilleabháin-Fitzgerald" and
 * "O Suilleabhain-Fitzgerald" compare equal. A scanned form is typed by
 * whoever held the pen: fadas get dropped, apostrophes become spaces, hyphens
 * come and go. Matching on the literal string means the clinic's Irish and
 * continental names are the ones that never match.
 */
export const fold = (value: string | null | undefined): string =>
  (value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/** Comparable chunks of a stored name: punctuation split, accents gone. */
export const foldedParts = (value: string | null | undefined): string[] =>
  fold(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/**
 * A written name split into full words and bare initials.
 *
 * "B. O Suilleabhain-Fitzgerald" → words [suilleabhain, fitzgerald],
 * initials [b, o]. The initials used to be discarded by a `length >= 2`
 * filter, which threw away the only thing tying the document to
 * "Bartholomew".
 */
export const nameParts = (
  value: string | null | undefined
): { words: string[]; initials: string[] } => {
  const chunks = foldedParts(value);
  return {
    words: chunks.filter((t) => t.length >= 2).slice(0, MAX_NAME_TOKENS),
    initials: chunks.filter((t) => t.length === 1).slice(0, MAX_NAME_TOKENS),
  };
};

/** Retained for callers that only want the full words. */
export const nameTokens = (value: string | null | undefined): string[] =>
  nameParts(value).words;

/**
 * Postgres-side twin of `fold()`. `translate` maps the accented characters
 * across and DELETES the punctuation at the tail of `from` (it has no
 * counterpart in `to`), so the column compares the same way the JS side does.
 * Done with `translate` rather than `unaccent` so no extension — and so no
 * migration — is required for the importer to match a name correctly.
 */
const ACCENT_FROM = 'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūýÿñńçćčšžł';
const ACCENT_TO = 'aaaaaaaeeeeeiiiiiooooooouuuuuyynncccszl';
const PUNCTUATION_TO_DROP = "'’`.-";

const foldColumn = (column: AnyColumn): SQL =>
  sql`translate(lower(coalesce(${column}, '')), ${`${ACCENT_FROM}${PUNCTUATION_TO_DROP}`}, ${ACCENT_TO})`;

/**
 * Does one word from the document account for one part of a stored name?
 *
 * Substring either way, so "Suilleabhain" reaches "O'Súilleabháin" once the
 * apostrophe and fada are folded off. Both sides must be 3+ characters for
 * that though: a record stored as initials ("J" "D") would otherwise swallow
 * any document naming a Jane Doe, since "jane" contains "j" — a wrong
 * auto-match, which is the one outcome worse than asking a human.
 */
const MIN_SUBSTRING_LENGTH = 3;

const wordCoversPart = (word: string, part: string): boolean =>
  word === part ||
  (word.length >= MIN_SUBSTRING_LENGTH &&
    part.length >= MIN_SUBSTRING_LENGTH &&
    (part.includes(word) || word.includes(part)));

const displayName = (row: { firstName: string; lastName: string | null }) =>
  row.lastName ? `${row.firstName} ${row.lastName}` : row.firstName;

/**
 * Deterministic candidate retrieval for a document (ENG-784).
 *
 * Three independent signals, OR'd in SQL and re-scored in code:
 *   email  — lower() equality (the only case-insensitive email lookup we have)
 *   phone  — last-9-digit suffix on phone OR whatsapp, digits only
 *   name   — every token of the extracted name appears in first or last name
 *
 * Returns at most 10, strongest first, each with its recent appointment
 * dates so the adjudicator can use "signed on the day of a booking" as a tie
 * breaker. Reads `lead` and `appointment` only — never writes.
 */
export const findLeadCandidates = async (
  tx: DbConnection,
  input: FindLeadCandidatesInput
): Promise<LeadCandidate[]> => {
  const email = input.email?.trim().toLowerCase() || null;
  const suffix = phoneSuffix(input.phone);
  const { words, initials } = nameParts(input.personName);

  const contactSignals: SQL[] = [];
  if (email) contactSignals.push(sql`lower(${lead.email}) = ${email}`);
  if (suffix) {
    const pattern = `%${suffix}`;
    contactSignals.push(
      sql`regexp_replace(coalesce(${lead.phone}, ''), '\\D', '', 'g') LIKE ${pattern}`,
      sql`regexp_replace(coalesce(${lead.whatsapp}, ''), '\\D', '', 'g') LIKE ${pattern}`
    );
  }

  /** One word against either name column, both sides accent-folded. */
  const wordMatches = (word: string): SQL => {
    const pattern = `%${word}%`;
    return sql`(${foldColumn(lead.firstName)} LIKE ${pattern} OR ${foldColumn(lead.lastName)} LIKE ${pattern})`;
  };

  const fetch = async (nameSignal: SQL | undefined) => {
    const signals = [...contactSignals, ...(nameSignal ? [nameSignal] : [])];
    if (signals.length === 0) return [];
    return tx.query.lead.findMany({
      where: and(
        eq(lead.organizationId, input.organizationId),
        notDeleted(lead),
        or(...signals)
      ),
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        whatsapp: true,
      },
      limit: MAX_ROWS,
    });
  };

  // Every word first — precise, and what a complete name should hit. Only if
  // that finds nothing do we widen to ANY word, which is what rescues a
  // document carrying a surname plus initials, or a first name the form
  // abbreviated. Scoring below decides what the looser sweep was worth, so
  // widening costs recall-shaped noise, never a wrong auto-match.
  let rows = await fetch(
    words.length > 0 ? and(...words.map(wordMatches)) : undefined
  );
  if (rows.length === 0 && words.length > 1) {
    rows = await fetch(or(...words.map(wordMatches)));
  }
  if (rows.length === 0) return [];

  const askedFor = words.length + initials.length;

  const scored: LeadCandidate[] = rows.map((row) => {
    const matchedOn: string[] = [];
    if (email && row.email?.trim().toLowerCase() === email) {
      matchedOn.push('email');
    }
    if (
      suffix &&
      (digitsOf(row.phone).endsWith(suffix) ||
        digitsOf(row.whatsapp).endsWith(suffix))
    ) {
      matchedOn.push('phone');
    }

    // How much of the document's name this client actually accounts for.
    // Substring either way so "Suilleabhain" reaches "O'Súilleabháin", and an
    // initial counts when a name part begins with it — "B." is Bartholomew.
    const parts = foldedParts(`${row.firstName} ${row.lastName ?? ''}`);
    const wordsHit = words.filter((w) =>
      parts.some((p) => wordCoversPart(w, p))
    ).length;
    const initialsHit = initials.filter((i) =>
      parts.some((p) => p.startsWith(i))
    ).length;
    const covered = wordsHit + initialsHit;
    const wholeName = askedFor > 0 && covered === askedFor && wordsHit > 0;
    if (wholeName) matchedOn.push('name');

    // A whole-name hit is a real identification, not a hint. It used to top
    // out at 0.6 — under the auto-match bar — so a correctly matched name
    // still went to a human every single time.
    const nameScore = wholeName
      ? wordsHit >= 2
        ? 0.85
        : 0.75
      : askedFor > 0
        ? 0.4 * (covered / askedFor)
        : 0;

    const score = matchedOn.includes('email')
      ? 1
      : matchedOn.includes('phone')
        ? 0.9
        : Math.max(nameScore, 0.1);

    return {
      leadId: row.id,
      name: displayName(row),
      email: row.email,
      phone: row.phone ?? row.whatsapp,
      matchedOn,
      score,
      lastAppointments: [],
    };
  });

  const top = scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, MAX_CANDIDATES);

  const appointments = await tx.query.appointment.findMany({
    where: inArray(
      appointment.leadId,
      top.map((c) => c.leadId)
    ),
    columns: { leadId: true, startDate: true },
    orderBy: [desc(appointment.startDate)],
    limit: top.length * APPOINTMENTS_PER_CANDIDATE * 2,
  });
  for (const candidate of top) {
    candidate.lastAppointments = appointments
      .filter((a) => a.leadId === candidate.leadId)
      .slice(0, APPOINTMENTS_PER_CANDIDATE)
      .map((a) => a.startDate.toISOString().slice(0, 10));
  }

  return top;
};
