/**
 * Takings capability port.
 *
 * Fifth application of the pattern, after `videos`, `meta-ads`, `lead-forms`
 * and `availability`. Like `availability` it exists because a capability was
 * MISSING — "what did we take today?" is the second thing an owner asks a
 * business assistant and Claire could not answer it at all — but the honesty
 * problem here is sharper, because the answer is a NUMBER and a number carries
 * no evidence of what it left out.
 *
 * THE FAILURE MODE THIS IS DESIGNED AGAINST. An under-reported takings figure
 * that looks authoritative. "You took €1,240 today" is acted on: it is checked
 * against the till, it decides whether a staff member is accused of a short
 * drawer, it goes in the owner's head as the day's number. A missing €300
 * is not a smaller answer, it is a WRONG one, and unlike a missing appointment
 * nothing about the reply hints that something is absent. So every way a read
 * can come back incomplete is a member of the result union rather than a
 * quietly-smaller total.
 *
 * There are four such ways, and none of them is hypothetical:
 *
 *   1. POS is read one DAY at a time. `GET /sales/daily-summary` takes a single
 *      `date`, so a range is N reads and any one of them can fail. A range that
 *      silently drops Tuesday under-reports the week. Hence `PosTakings.
 *      datesRead` and a gap that names the dates it could not get.
 *   2. DEPOSITS ARE A SEPARATE MONEY CHANNEL. `payment` (Stripe deposit /
 *      checkout links) is a different table from `sale_payment` (POS tenders),
 *      and the daily summary reads only the latter. Money genuinely taken via a
 *      deposit link appears in NEITHER `byMethod` nor `totalCents`. Reporting
 *      the POS figure alone as "takings" is the under-report, so deposits are a
 *      first-class channel here and never folded silently into a POS total.
 *   3. DEPOSITS CANNOT BE RANGE-FILTERED. `GET /payments` accepts only
 *      `leadId`, `status`, `limit`, `offset` — there is no `from`/`to`, and
 *      rows are ordered by `createdAt` while what matters is `paidAt`. A
 *      deposit link created in January and paid today sorts near the bottom.
 *      Completeness can therefore only be PROVEN by reading every row, which
 *      is bounded; when it cannot be proven the channel is unread, not zero.
 *   4. CURRENCIES DO NOT ADD. POS currency is derived per-day from the org's
 *      primary location; a deposit row carries its own. Two currencies summed
 *      into one integer is a wrong number that no consumer can detect.
 *
 * WHY `partially_read` USES A NON-EMPTY TUPLE. `availability` documents that
 * a partial read "cannot be constructed without naming the sources that
 * failed"; here that is enforced by the type — `unread` is
 * `readonly [TakingsGap, ...TakingsGap[]]`, so `unread: []` does not compile.
 * A partial read with nothing named would be indistinguishable from a complete
 * one at exactly the moment that distinction is worth money.
 *
 * MONEY IS NEVER A BARE NUMBER. Every amount is a `MoneyAmount` carrying its
 * integer cents, its currency and a preformatted string. A `number` on the wire
 * is cents; a model reading `1240` as "€1,240" instead of "€12.40" is a
 * hundredfold error, and the shape is what prevents it.
 */

/**
 * A monetary amount. Never emit a bare number for money — this type exists so
 * the unit and the currency travel with the value.
 */
export interface MoneyAmount {
  /** Integer MINOR units (cents). Never currency units, never a float. */
  amountCents: number;
  /** ISO-4217 code as the API returns it (lowercase, e.g. `'eur'`). */
  currency: string;
  /**
   * Rendered with symbol and decimal point, e.g. `'€1,240.00'`. The only field
   * safe to quote verbatim to a person.
   */
  formatted: string;
}

/** The two independent channels money arrives through. */
export type TakingsChannel = 'pos' | 'deposits';

/**
 * One thing the answer does NOT include. Present only on `partially_read`, and
 * required there, so an incomplete total can never be phrased as a complete
 * one.
 */
export type TakingsGap =
  /**
   * Named dates whose POS summary could not be read. The dates matter: "I
   * couldn't read Tuesday" is a checkable statement, "some of it is missing"
   * is not.
   */
  | { channel: 'pos'; dates: string[]; reason: string }
  /** Deposits could not be read, or could not be proven complete. */
  | { channel: 'deposits'; reason: string };

/** Takings collected through one tender method at the till. */
export interface TenderTotal {
  /**
   * Raw method key as stored (`cash`, `card_terminal`, `qr_self_checkout`,
   * `manual_card`, `gift_card`). Deliberately `string` rather than the label
   * enum: a method added to the DB before this port is updated must widen the
   * breakdown, not fail the read and lose the whole day's figure.
   */
  method: string;
  /** Display label; falls back to the raw key for an unrecognised method. */
  label: string;
  /** Gross collected through this method, refunds NOT deducted. */
  collected: MoneyAmount;
  /** Of `collected`, how much was subsequently refunded. */
  refunded: MoneyAmount;
}

/** Point-of-sale takings: completed sales, by `completedAt`. */
export interface PosTakings {
  /**
   * The dates actually summed. On a complete read this is every date in the
   * window; on a partial read it is a subset, and the difference is named in
   * `unread`.
   */
  datesRead: string[];
  /** Completed sales across `datesRead`. */
  saleCount: number;
  /** Sum of completed sale totals. Tips are separate — see `tips`. */
  salesTotal: MoneyAmount;
  tips: MoneyAmount;
  /**
   * Sum of `byTender[].collected`. This is the till's cash-in figure and need
   * NOT equal `salesTotal`: tenders include tips, and a refunded tender is
   * counted as collected as well as refunded.
   */
  collected: MoneyAmount;
  refunded: MoneyAmount;
  byTender: TenderTotal[];
}

/** Money taken through deposit / checkout links. Never part of POS totals. */
export interface DepositTakings {
  /** Deposit payments marked paid within the window. */
  count: number;
  paid: MoneyAmount;
}

/** The window actually examined, echoed back so a caller cannot misreport it. */
export interface TakingsWindow {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. */
  to: string;
  /**
   * Location the POS figure is scoped to, or `null` for the whole org. Note
   * that deposits carry no location, so a location-scoped request cannot
   * include them — that is reported as a gap, not as zero deposits.
   */
  locationId: string | null;
}

/**
 * Why no figure could be produced at all. Split from a partial read on purpose:
 * this means we learned nothing, not that we learned some of it.
 */
export type TakingsBlockedReason =
  /** `to` before `from`, or a date that is not YYYY-MM-DD. */
  | { kind: 'invalid_window'; message: string }
  /** The range exceeds what one read may fan out over. */
  | { kind: 'window_too_wide'; message: string; maxDays: number }
  /**
   * The days in range reported different currencies. Summing them would
   * produce a confident wrong number, so no total is produced.
   */
  | { kind: 'mixed_currency'; message: string; currencies: string[] }
  /** The server stated a refusal this union does not name — carried verbatim
   *  rather than mis-classified. */
  | { kind: 'other'; message: string }
  /** The server faulted. Alertable, and NOT an owner-actionable refusal. */
  | { kind: 'server_error'; message: string };

export type GetTakingsResult =
  /**
   * Every day in the window and every channel was read. This is the ONLY
   * member in which the figures may be presented as the period's takings.
   */
  | {
      status: 'read';
      window: TakingsWindow;
      pos: PosTakings;
      deposits: DepositTakings;
    }
  /**
   * Some of it is missing. The figures present are real, but they are a FLOOR,
   * not the total — consumers must phrase this as "at least X; I could not
   * read Y."
   *
   * `deposits: null` means that channel was not read at all; it never means
   * zero. `unread` is a non-empty tuple, so this member cannot be constructed
   * without saying what is missing.
   */
  | {
      status: 'partially_read';
      window: TakingsWindow;
      pos: PosTakings;
      deposits: DepositTakings | null;
      unread: readonly [TakingsGap, ...TakingsGap[]];
    }
  /** Nothing was learned. No figure of any kind. */
  | { status: 'blocked'; reason: TakingsBlockedReason };

export interface GetTakingsInput {
  /** YYYY-MM-DD, inclusive. */
  from: string;
  /** YYYY-MM-DD, inclusive. Same as `from` for a single day. */
  to: string;
  /**
   * Scope the POS figure to one location. Omit for the whole org. Supplying it
   * makes deposits unreadable (they have no location), which is reported as a
   * gap rather than silently dropping that channel.
   */
  locationId?: string;
}

export interface SalesPort {
  /**
   * Answer "what did we take?" for a date range, split by tender.
   *
   * Composes the two independent money channels (POS tenders and deposit
   * links) and names every day or channel it could not read, so an incomplete
   * figure can never be presented as the period's takings.
   */
  getTakings(input: GetTakingsInput): Promise<GetTakingsResult>;
}
