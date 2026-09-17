/**
 * Catalog capability port — "everything this business sells".
 *
 * Fifth application of the pattern, after `videos`, `meta-ads`, `lead-forms`
 * and `availability`. Like `availability` it exists because of a MISSING
 * capability, but the failure mode is commercial rather than diagnostic.
 *
 * THE GAP. Claire actively sells: `offers_suggestIntroOffer`,
 * `claire_publishOffer`, `context_listServices`. Gate 6 found she can see
 * exactly ONE of the three things an org actually puts on sale:
 *
 *   services      a single appointment. `context_listServices` — visible.
 *   packages      a bundle of N services sold as one item (a course of six,
 *                 a bridal package). INVISIBLE.
 *   memberships   a plan bought once for a term, or billed on repeat.
 *                 INVISIBLE.
 *
 * The cost is not "an incomplete list". It is that she recommends a €70
 * treatment to someone who would have bought the €360 course of six, because
 * the course does not exist as far as she can see. A salesperson who can only
 * see a third of the price list will reliably under-sell, and never know.
 *
 * THE HONESTY RULE. `listSellables` composes three independent reads, so it
 * inherits the rule from `availability.port.ts`: a catalogue assembled from
 * two of three sources presented as "here is everything you sell" is a lie,
 * and it is the expensive direction of lie — the model does not offer the
 * thing it could not see, and nobody ever learns a sale was lost.
 *
 * So `read` and `partially_read` are separate MEMBERS, and `partially_read`
 * cannot be constructed without naming the sources that failed. There is no
 * shape in which a complete-sounding catalogue can be returned from an
 * incomplete read.
 *
 * WHY GIFT CARDS ARE NOT HERE. They look like a fourth sellable and are not.
 * `GET /gift-cards` returns ISSUED cards — a specific customer's code, balance
 * and expiry. That is a liability ledger, not a price list, and folding it in
 * would let the model answer "what do you sell?" with someone's remaining
 * €37.50. The gift card PRODUCT is the org's preset denominations, which live
 * on `GET /org-defaults` (`giftCardPresetAmounts` / `giftCardExpiry`) — a
 * different capability area, with its own coverage decision. Listing gift cards
 * here was considered and deliberately refused; see the gift-cards coverage
 * note.
 *
 * MONEY IS ALWAYS INTEGER CENTS, and every field carrying it says so in its
 * name. No field in this port holds a currency-unit number, because a model
 * reading `price: 3600` as "€3,600" quotes ten times the real figure.
 */

/** The three things an org puts on sale. */
export type SellableKind = 'service' | 'package' | 'membership';

/** The list read that backs each kind. Named separately from `SellableKind`
 *  because a source is a thing that can FAIL, and a kind is not. */
export type SellableSource = 'services' | 'packages' | 'memberships';

/**
 * How a thing is charged for.
 *
 * This union is the reason the port exists in this shape. A service, a package
 * and a membership are priced in three incompatible ways — one-off, bundle-of-N
 * and per-period — and flattening them into a single `price` number would let
 * the model say "the membership is €60" about a plan that is €60 EVERY MONTH.
 * That is not a rounding error in a sales pitch; it is a misquote the business
 * has to honour or retract.
 *
 * Each member therefore carries the fields that make its own quote sayable,
 * and nothing else. A consumer cannot read a recurring price without also
 * seeing the period, because they are in the same object.
 */
export type SellablePrice =
  /** One payment, exact. The only member you may quote as a flat price. */
  | { model: 'one_off'; amountCents: number }
  /**
   * One payment, but the amount is a FLOOR — the real price is higher and is
   * settled in person. Must be spoken as "from X", never as "X".
   */
  | { model: 'from'; fromAmountCents: number }
  /** No charge. */
  | { model: 'free' }
  /** Quoted in consultation. There is NO amount, and inventing one is the
   *  failure this member exists to make impossible. */
  | { model: 'on_consultation' }
  /**
   * One payment that buys a bundle, optionally expiring.
   *
   * `itemCount` is the total number of sessions the bundle contains (the sum
   * of the line quantities), which is what makes "six treatments for €360"
   * sayable and lets the model compare it against the single-visit price.
   */
  | {
      model: 'bundle';
      amountCents: number;
      itemCount: number;
      /** Days from purchase before it expires. `null` = no expiry. */
      validityDays: number | null;
    }
  /**
   * A membership bought ONCE, granting entitlements for a fixed term. Priced
   * like a bundle, but bounded by time rather than by a count of sessions —
   * so the term is required, not optional.
   */
  | {
      model: 'prepaid_term';
      amountCents: number;
      /** Sessions included over the term. `null` = unlimited. */
      sessionCount: number | null;
      /** Raw term code, e.g. `3m`. */
      term: string;
      /** Human term, e.g. `3 months`. Quote this, not the code. */
      termLabel: string;
    }
  /**
   * A membership billed AGAIN every period against a stored card, until
   * cancelled. `amountCents` is the per-period charge, never the total.
   */
  | {
      model: 'recurring';
      amountCents: number;
      sessionCount: number | null;
      /** Raw period code, e.g. `1m`. */
      period: string;
      /** Human period, e.g. `1 month`. Quote this, not the code. */
      periodLabel: string;
    }
  /**
   * The row declares a priced type but carries no amount — a data gap, not a
   * price of zero. Distinguished from `free` and from `on_consultation`
   * because collapsing it into either produces a confident wrong quote.
   *
   * `legacyText` is the pre-structured free-text price some older rows still
   * carry. It is display text, NOT an amount, and is surfaced only here.
   */
  | { model: 'unpriced'; declaredType: string; legacyText: string | null };

/** A priced option a buyer chooses between (a service variant). */
export interface SellableOption {
  name: string;
  /** `null` when the variant carries no price of its own. */
  priceCents: number | null;
  durationMinutes: number | null;
}

/**
 * One thing the business sells, normalised across the three sources so the
 * model can compare a service against a package against a membership in a
 * single pass — which is the whole point.
 */
export interface Sellable {
  kind: SellableKind;
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  price: SellablePrice;
  /**
   * ISO currency code where the source states one. `null` means the source
   * does not carry a currency and the org's display currency applies — which
   * this port cannot resolve, so it does not guess.
   */
  currencyCode: string | null;
  /** Chair time for one visit. `null` where the source has no duration. */
  durationMinutes: number | null;
  /** Priced options a buyer picks between. Empty when there is one price. */
  options: SellableOption[];
  /**
   * Services this entitles the buyer to. Empty for a plain service (it IS the
   * service). Populated for packages and memberships, so the model can answer
   * "does the membership cover a facial?".
   */
  includedServiceIds: string[];
}

/** Why nothing at all could be listed. Separate from a partial read: this
 *  means we learned nothing, not that we learned some of it. */
export type CatalogBlockedReason =
  /** The caller asked for an empty or unrecognised set of kinds. */
  | { kind: 'invalid_input'; message: string }
  /** The server stated a refusal this union does not name — carried verbatim
   *  rather than mis-classified. */
  | { kind: 'other'; message: string }
  /** The server faulted. Alertable, and NOT an owner-actionable refusal. */
  | { kind: 'server_error'; message: string };

export type ListSellablesResult =
  /**
   * Every requested source was read. This is the ONLY member in which
   * "that is everything they sell" is a true statement.
   */
  | { status: 'read'; sellables: Sellable[]; read: SellableSource[] }
  /**
   * Some sources failed. What is listed is real; the ABSENCE of a package
   * proves nothing when the package read failed, which is why `unread` is
   * required.
   *
   * Consumers must phrase this as "here are the services and memberships; I
   * couldn't read the packages" — never as a complete price list.
   */
  | {
      status: 'partially_read';
      sellables: Sellable[];
      read: SellableSource[];
      unread: SellableSource[];
    }
  /** Nothing was learned. */
  | { status: 'blocked'; reason: CatalogBlockedReason };

export interface ListSellablesInput {
  /** Restrict to these kinds. Omit for everything. An empty array is an
   *  error rather than a silent "nothing", which would read as an empty shop. */
  kinds?: SellableKind[];
  /**
   * Include things switched off. Default `false`: an inactive item is not for
   * sale, and pitching one loses the sale twice — once when it is quoted and
   * again when it is withdrawn.
   */
  includeInactive?: boolean;
}

export interface CatalogPort {
  /**
   * List everything the business sells, normalised across services, packages
   * and memberships, naming any source that could not be read.
   */
  listSellables(input: ListSellablesInput): Promise<ListSellablesResult>;
}
