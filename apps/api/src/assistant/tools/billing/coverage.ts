import { defineCoverage } from '../coverage.types.js';

/**
 * BILLING — 10 endpoints, 0 tools. Do not skim this one: it is the clearest
 * case in this batch of a GENUINE CAPABILITY HIDING IN PLUMBING, and the split
 * between its reads and its writes is unusually sharp.
 *
 * THE READS ARE THE FINDING. Claire's own answers are gated on plan and
 * credits — `campaigns_checkChannels` already reports channels blocked by
 * entitlement, ad and content flows spend credits, and every price she quotes
 * is denominated in the org's billing currency. Today she can tell an owner a
 * channel is blocked but not that the plan is why, and she cannot answer "have
 * I got enough credits to render this?" before starting a job that will fail
 * halfway. Four of the five reads here are one small tool away from closing
 * that, and none of them exposes a card number or a payment method.
 *
 * THE WRITES ARE MONEY. Starting a subscription, buying credits, or cancelling
 * a plan all change what the business is charged. Two of them return Stripe
 * Checkout or Portal URLs that are single-use and bound to a browser session,
 * so they are unusable to an agent anyway; the cancel is simply not something
 * that should be one sentence away in a chat window.
 */
export const billingCoverage = defineCoverage('billing', {
  // ---- reads: the gap worth closing --------------------------------------
  // These gate answers Claire already gives. She can say "WhatsApp is blocked"
  // without being able to say "because you're on Starter", which is the half
  // the owner needs in order to act.
  'GET /billing/plan': { undecided: 'ENG-CLAIRE-BILLING-READ' },
  'GET /billing/subscription': { undecided: 'ENG-CLAIRE-BILLING-READ' },
  'GET /billing/credits': { undecided: 'ENG-CLAIRE-BILLING-READ' },
  'GET /billing/currency': { undecided: 'ENG-CLAIRE-BILLING-READ' },

  'GET /billing/credits/packages': {
    notExposed:
      'The purchasable credit bundles and their prices — a shop window whose only use is to lead into a checkout Claire cannot complete. Quoting prices she cannot let the owner act on invites her to sell.',
  },

  // ---- writes: money -----------------------------------------------------
  'POST /billing/subscription/seed': {
    notExposed:
      'Turns this workspace into a paying one by naming a Stripe subscription bought on a sales call. The id exists only in the Stripe dashboard and in the operator\u2019s notes — nothing Claire can see — and attaching the wrong one bills a plan to a business that never agreed to it.',
  },
  'POST /billing/subscription/checkout': {
    notExposed:
      'Creates a Stripe Checkout session for a plan. The returned URL is single-use and bound to the browser that opens it, and the act behind it is committing the business to a recurring charge.',
  },
  'POST /billing/credits/checkout': {
    notExposed:
      'Same Checkout mechanics for a one-off credit purchase. An agent that can initiate spending on the owner’s card is a category we do not want to open, however small the amount.',
  },
  'POST /billing/subscription/cancel': {
    notExposed:
      'Cancels the plan. It silently disables the messaging channels, ad publishing and content generation the whole product is used for, and the loss only becomes visible when something stops working.',
  },
  'POST /billing/portal': {
    notExposed:
      'Mints a Stripe Billing Portal link where cards and invoices are managed. It is a credential for a browser session, and handing it to a model produces a link that expires unused.',
  },

  // ---- delivery ----------------------------------------------------------
  'POST /billing/webhook': {
    notExposed:
      'Stripe’s signed platform-billing delivery, verified against Stripe-Signature over the raw body. It is the only writer of subscription and entitlement state, so a forged event would grant paid capacity with no payment behind it.',
  },
});
