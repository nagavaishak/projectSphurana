import { defineCoverage } from '../coverage.types.js';

/**
 * GIFT-CARDS — 4 endpoints, 0 tools. Stored-value cards: three lookups and one
 * balance adjustment. Note the shape — there is no create route here, because
 * gift cards are issued through the sale that sells them; this controller only
 * reads them and moves the balance.
 *
 * The lookups, especially `by-code`, are a plausible Claire capability: "how
 * much is left on this card?" is a front-of-house question asked in words, and
 * the answer is a balance, not a customer's history. They are parked as
 * `undecided` because no tool exists. The single write is refused — a gift card
 * balance is a liability the business owes the bearer, so adjusting it is
 * moving money in everything but name.
 *
 * CONSIDERED AND REFUSED for the sellables catalogue. When `packages_
 * listSellables` was built to let Claire see everything the org sells, gift
 * cards were the obvious fourth kind and were deliberately left out: these
 * routes return ISSUED cards — one customer's code, balance and expiry — which
 * is a liability ledger, not a price list. Folding them in would let "what do
 * you sell?" be answered with somebody's remaining €37.50. The gift card
 * PRODUCT is the org's preset denominations, which live on `GET /org-defaults`
 * (`giftCardPresetAmounts` / `giftCardExpiry`) and belong to that area's
 * decision. See `packages/contracts/src/ports/catalog.port.ts`.
 */
export const giftCardsCoverage = defineCoverage('gift-cards', {
  // ---- reads -------------------------------------------------------------
  'GET /gift-cards': { undecided: 'ENG-CLAIRE-GIFT-CARDS' },
  'GET /gift-cards/:id': { undecided: 'ENG-CLAIRE-GIFT-CARDS' },
  'GET /gift-cards/by-code/:code': { undecided: 'ENG-CLAIRE-GIFT-CARDS' },

  // ---- writes ------------------------------------------------------------
  'POST /gift-cards/:id/adjust': {
    notExposed:
      'Credits or debits a stored-value balance, which is money the business owes whoever holds the card. Topping one up creates a liability out of nothing and debiting one takes value a customer paid for.',
  },
});
