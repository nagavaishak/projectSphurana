/**
 * Normalisation + SHA-256 hashing for Meta Conversions API `user_data`.
 *
 * WHY THIS FILE IS ITS OWN UNIT, AND TESTED AGAINST FIXED DIGESTS.
 *
 * A wrongly-normalised hash does not fail. Meta accepts the payload, returns
 * `events_received: 1`, and matches NOTHING — which on the dashboard is
 * indistinguishable from "our ads reach people who don't convert". The failure
 * mode of this file is silent, permanent, and looks like a marketing problem,
 * so the normalisation rules are pinned to known input → known digest in
 * `hash-user-data.test.ts`.
 *
 * Rules are Meta's (Customer Information Parameters): trim, lowercase, strip
 * the formatting a human typed, then SHA-256 and send lowercase hex.
 *
 * `client_ip_address`, `client_user_agent`, `fbc` and `fbp` are deliberately
 * NOT hashed — Meta requires them raw. They are carried on the un-hashed side
 * of {@link HashedUserData} for exactly that reason.
 */

import { createHash } from 'node:crypto';

/** Raw, human-entered customer data. Never log this — hashing it is the point. */
export interface RawUserData {
  email?: string | null;
  /** Any format; punctuation and a leading `+` are stripped before hashing. */
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  city?: string | null;
  /** State/county. Two-letter code where one exists. */
  state?: string | null;
  zip?: string | null;
  /** ISO-3166-1 alpha-2. */
  country?: string | null;
  /** `YYYY-MM-DD` or `YYYYMMDD`. */
  dateOfBirth?: string | null;
  gender?: 'f' | 'm' | string | null;
  /**
   * Your own stable id for the person — we send the lead id. Hashed, so it
   * never leaves as a readable identifier, but still joins across events.
   */
  externalId?: string | null;

  // --- sent RAW, per Meta's spec ---
  clientIpAddress?: string | null;
  clientUserAgent?: string | null;
  /** `_fbc` cookie — the click id. The single strongest match signal. */
  fbc?: string | null;
  /** `_fbp` cookie — the browser id. */
  fbp?: string | null;
}

/** The wire shape of `user_data`. Hashed fields are lowercase hex SHA-256. */
export interface HashedUserData {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  ct?: string[];
  st?: string[];
  zp?: string[];
  country?: string[];
  db?: string[];
  ge?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbc?: string;
  fbp?: string;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Hash, or drop the field entirely — never send an empty-string digest. */
const hashOrUndefined = (value: string | undefined): string[] | undefined =>
  value ? [sha256(value)] : undefined;

const base = (value: string | null | undefined): string =>
  (value ?? '').trim().toLowerCase();

/** Strip everything but letters/digits — Meta's rule for names, city, state. */
const alphanumeric = (value: string): string => value.replace(/[^a-z0-9]/g, '');

export const normalizeEmail = (value: string | null | undefined): string =>
  base(value);

/**
 * Digits only. A leading `+` and every space/bracket/dash goes; the country
 * code STAYS (Meta matches on the full international number).
 */
export const normalizePhone = (value: string | null | undefined): string =>
  (value ?? '').replace(/\D/g, '').replace(/^0+/, '');

export const normalizeName = (value: string | null | undefined): string =>
  alphanumeric(base(value));

export const normalizeZip = (value: string | null | undefined): string =>
  base(value).replace(/\s/g, '').split('-')[0] ?? '';

export const normalizeCountry = (value: string | null | undefined): string =>
  base(value).slice(0, 2);

/** `YYYY-MM-DD` / `YYYY/MM/DD` / `YYYYMMDD` → `YYYYMMDD`. */
export const normalizeDateOfBirth = (
  value: string | null | undefined
): string => (value ?? '').replace(/\D/g, '').slice(0, 8);

export const normalizeGender = (value: string | null | undefined): string => {
  const g = base(value);
  if (g.startsWith('f')) return 'f';
  if (g.startsWith('m')) return 'm';
  return '';
};

/**
 * Normalise then SHA-256 every identifying field; pass the browser-side
 * signals through untouched. Absent/blank fields are omitted rather than sent
 * as a hash of the empty string — a digest of `''` is a real, matchable value
 * and would poison matching for every customer who left the field blank.
 */
export const hashUserData = (raw: RawUserData): HashedUserData => {
  const hashed: HashedUserData = {
    em: hashOrUndefined(normalizeEmail(raw.email)),
    ph: hashOrUndefined(normalizePhone(raw.phone)),
    fn: hashOrUndefined(normalizeName(raw.firstName)),
    ln: hashOrUndefined(normalizeName(raw.lastName)),
    ct: hashOrUndefined(normalizeName(raw.city)),
    st: hashOrUndefined(normalizeName(raw.state)),
    zp: hashOrUndefined(normalizeZip(raw.zip)),
    country: hashOrUndefined(normalizeCountry(raw.country)),
    db: hashOrUndefined(normalizeDateOfBirth(raw.dateOfBirth)),
    ge: hashOrUndefined(normalizeGender(raw.gender)),
    external_id: hashOrUndefined(base(raw.externalId)),
    client_ip_address: raw.clientIpAddress ?? undefined,
    client_user_agent: raw.clientUserAgent ?? undefined,
    fbc: raw.fbc ?? undefined,
    fbp: raw.fbp ?? undefined,
  };

  // Drop undefined keys so the JSON body carries only what we actually have.
  for (const key of Object.keys(hashed) as (keyof HashedUserData)[]) {
    if (hashed[key] === undefined) delete hashed[key];
  }

  return hashed;
};

/**
 * True when there is at least one identifier Meta can match on. A CAPI event
 * with no match keys is accepted and attributed to nobody.
 */
export const hasMatchKey = (userData: HashedUserData): boolean =>
  Boolean(
    userData.em?.length ||
      userData.ph?.length ||
      userData.external_id?.length ||
      userData.fbc ||
      userData.fbp
  );
