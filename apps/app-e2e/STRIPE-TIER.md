# Real-Money E2E Tier — Stripe Stub vs Test-Mode (Decision + Plan)

> Companion to `TAB-SUITE.md` §6.B. Resolves the open decision on how to give the
> broad E2E suite coverage of the card / subscription / deposit money paths that
> cash tenders can't reach. Branch: `feat/fresha-clone`. Investigation-only;
> no product code was changed.

---

## 0. Decision (TL;DR)

**Adopt an env-gated deterministic-webhook-injection STUB for breadth, keyed off
the ONE Stripe-client seam. Do NOT stand up a real-Stripe-test-mode E2E tier for
the broad suite.** Confirmed the handoff lean, with evidence below.

Rationale, evidence-backed:
- The webhook router (`stripe-connect-webhooks.controller.ts`) already delegates
  to **structured-input feature services** — none of them consume a raw
  `Stripe.Event`. A test endpoint can call those exact services directly and
  reproduce the real settlement path minus signature verification. The stub is
  ~1 controller endpoint + ~1 service method, no product-code change.
- Real-test-mode buys almost nothing the stub can't, and costs a lot:
  - **card_terminal / Tap to Pay is device-only** — `payment_method_types:
    ['card_present']`, reader-driven collect/confirm client-side
    (`stripe-connect.service.ts:299-317`). No browser can settle it. It belongs
    in the **native Maestro lane** (`TAB-SUITE.md` §6.D), never here.
    Real-test-mode wouldn't unblock it either.
  - **manual_card** needs Stripe Elements + a real `client_secret` confirmed in
    an iframe — non-deterministic, network-bound, flaky in CI.
  - **Webhook async timing** — real test-mode webhooks arrive out-of-band
    (Stripe CLI forward / retries). The suite is `fullyParallel`, per-test-org;
    waiting on real async delivery reintroduces exactly the flake `TAB-SUITE.md`
    §4.9 fought. Deterministic injection is synchronous.
  - **Connect onboarding completion** can't be automated in test-mode without
    the hosted onboarding UI; only `account.updated` matters to our code, and
    that's a `syncStripeAccountStatus` call the stub can inject directly.
  - **CI secrets** — real-test-mode needs live `sk_test_` + Connect client id +
    two webhook secrets available to every preview app; the stub needs none.
- **Guard against stub-hides-a-real-bug**: the **integration tier already covers
  the Stripe wiring** (`payments-infra.int-spec.ts`, `deposits.int-spec.ts`
  assert controller→service wiring and state guards *before* any Stripe call),
  and **unit tests cover the Stripe client contract with a mocked client**
  (`add-sale-payment.test.ts`, `settle-card-payment.test.ts`,
  `handle-sale-payment-webhook.test.ts`, `handle-deposit-webhook.test.ts`,
  `refund-deposit.test.ts`). The stub adds the **UI→settlement→completed-sale**
  leg those layers can't. Depth stays in unit/integration (`TAB-SUITE.md` §2).
  A tiny **real-tier smoke** (§6 below) stays OPTIONAL/nightly, off the per-PR
  gate, so the real SDK path isn't 100% unexercised — but it is not required for
  breadth and must never gate PRs.

---

## 1. The seam (exact file/function to gate)

There is **one** Stripe client construction point per service, both lazy
singletons — this is the only seam that needs touching, and the recommendation
is **NOT to touch it**. The stub works *below* the SDK by calling the settlement
services directly, so the SDK factory is left alone.

| Client | Factory (singleton) | Constructs |
|--------|--------------------|-----------|
| Platform billing | `getStripeService()` — `packages/integrations/src/stripe/stripe.service.ts:587-590` | `new Stripe(key)` at `:108` |
| Connect (sales/deposits/terminal) | `getStripeConnectService()` — `packages/integrations/src/stripe/stripe-connect.service.ts:871-876` | `new Stripe(key)` at `:46` |

Outbound Stripe calls the sale tenders make (all on the Connect client):
- `card_terminal` → `createTerminalPaymentIntent` (`:299`), settled async by
  `payment_intent.succeeded` webhook. `add-sale-payment.service.ts:303`.
- `manual_card` → `createCardPaymentIntent` (`:341`), settled by
  `settle-card-payment.service.ts` (sync, `retrievePaymentIntentStatus` `:324`)
  OR the same webhook. `add-sale-payment.service.ts:355`.
- `qr_self_checkout` → `createPaymentLink` (`:622`), settled by
  `checkout.session.completed`. `add-sale-payment.service.ts:406`.

**Key finding — settlement never parses a raw event.** The webhook controller
verifies the signature, then routes by `event.type` + `metadata.type` and calls:

| Path | Settlement service (structured input) |
|------|---------------------------------------|
| sale tender (all 3) | `handleSalePaymentWebhook` — `packages/features/src/sales/services/handle-sale-payment-webhook` |
| general payment | `handlePaymentWebhook` — `.../payments` |
| appointment deposit | `handleDepositWebhook` — `.../appointments` |
| recurring membership | `handleMembershipSubscriptionWebhook` — `.../memberships` |
| Connect account status | `syncStripeAccountStatus` — `.../integrations` |

`handleSalePaymentWebhookSchema` (the input contract) is
`{ eventType, paymentIntentId?, metadata?, amountRefundedCents?, amountCapturedCents? }`
— pure data, no `Stripe.Event`. Ref:
`packages/features/src/sales/services/handle-sale-payment-webhook/handle-sale-payment-webhook.schema.ts`.
That is the injection contract.

---

## 2. Test-only webhook-injection endpoint (shape)

Mirror the existing `POST /testing/simulate-webhook` (Meta chatbot) —
`apps/api/src/testing/testing.controller.ts:244-260` — and the settlement router
in `stripe-connect-webhooks.controller.ts:88-360`. New endpoint lives in the
**same testing controller**, **safe-token tier** (`validateSeedToken`, NOT
destructive — it touches only the caller's own seeded org and makes no outbound
call; same tier as `simulate-webhook`).

```
POST /testing/simulate-stripe-webhook          (validateSeedToken, @HttpCode 200)
Authorization: Bearer <E2E_SEED_TOKEN>
{
  eventType:
    | 'checkout.session.completed'      // qr_self_checkout, general payment, deposit
    | 'payment_intent.succeeded'        // card_terminal, manual_card
    | 'payment_intent.payment_failed'
    | 'charge.refunded'
    | 'account.updated'                 // Connect onboarding completion
    | 'customer.subscription.updated'   // recurring membership renew
    | 'customer.subscription.deleted',
  // routing keys (mirror the real controller's metadata.type dispatch):
  metadata?: { type: 'sale_payment' | 'payment' | 'appointment_deposit'; salePaymentId?; saleId?; organizationId? },
  paymentIntentId?: string,
  checkoutSessionId?: string,
  amountRefundedCents?: number,
  amountCapturedCents?: number,
  // account.updated:
  stripeAccountId?: string, chargesEnabled?: boolean, payoutsEnabled?: boolean, detailsSubmitted?: boolean,
  // subscription.*:
  stripeSubscriptionId?: string, stripeStatus?: string, currentPeriodEndSec?: number,
}
```

Handler = a thin re-implementation of the controller's routing block
(`stripe-connect-webhooks.controller.ts:136-356`), calling the **same services
under `withSystemScope`**, minus `constructConnectWebhookEvent`. Put the routing
in `TestingService.simulateStripeWebhook(body)` (so the controller stays thin,
per `.claude/rules/api/controller.md`); it returns
`{ received, processed, action }` exactly like the real endpoint.

To make settlement resolve a real row, the E2E flow first drives the UI to
create the **pending** tender (which writes the `sale_payment` row + real-looking
`stripePaymentIntentId` — but in the stub the SDK call must be short-circuited;
see §4), then injects `payment_intent.succeeded` with that
`{ salePaymentId, paymentIntentId }`. `handleSalePaymentWebhook` flips the row to
`succeeded` and `autoCompleteIfFullyPaid` closes the sale — identical to prod.

**Connect seed helper** (prereq for any card tender — `add-sale-payment` needs
`stripeConnectIntegration`): reuse `POST /testing/force-subscription`'s pattern
(`testing.controller.ts:219-227`) with a new
`POST /testing/seed-stripe-connect { organizationId }` that inserts a
`stripe_connect_integration` row (`packages/database/src/schema/stripe-connect-integration.ts`)
with `stripeAccountId: 'acct_e2e_<id>'`, `accountType: 'controller'`,
`chargesEnabled/payoutsEnabled/detailsSubmitted: true`, `isActive: true`,
`defaultCurrency` from the org. Destructive tier (`validateDestructiveAccess`).

---

## 3. Stub of the outbound SDK calls (the only real "stub")

The pending-row insert in `add-sale-payment` runs the SDK call for real
(`createTerminalPaymentIntent` / `createCardPaymentIntent` / `createPaymentLink`).
Two options; **prefer B**:

- **A. Real test-mode SDK for the *create* leg.** Keeps the client, uses
  `sk_test_`; the *create* PI/PaymentLink call succeeds against Stripe, we then
  inject settlement. Downside: needs the CI secret + the seeded Connect account
  to be a real test-mode `acct_`, which we don't have. Rejected for breadth.
- **B. Env-gated fake at the seam (recommended).** Wrap the two singletons so
  that when `STRIPE_E2E_STUB=true` (set only on preview/local E2E hosts, never
  prod), `getStripeConnectService()` returns a fake whose `create*` methods
  return deterministic ids (`pi_e2e_<uuid>`, `plink_e2e_<uuid>`,
  `cs_e2e_<uuid>`) with `status: 'requires_payment_method'` / a fake link URL,
  and `retrievePaymentIntentStatus` returns `succeeded` for `pi_e2e_*`. This is
  the single net-new backend seam. Gate it inside the factory functions above
  (add an `if (env.STRIPE_E2E_STUB) return stubConnectService` branch) so
  product code and the DI graph are untouched. The fake lives in
  `packages/integrations/src/stripe/` behind the env flag; prod bundles never
  hit the branch.

With B, `settle-card-payment` also settles synchronously in-browser
(`retrievePaymentIntentStatus` → `succeeded`), so **manual_card** needs no
webhook injection at all — the UI confirm→settle path closes the sale. That
makes manual_card the *least* device-dependent card tender to E2E.

---

## 4. Which specs each path unlocks

All new specs live in `src/sales/` (+ `src/calendar/` for deposits) at BOTH
viewports via the `tabs` / `tabs-mobile` projects (`TAB-SUITE.md` §2), gated
`test.skip(!process.env.STRIPE_E2E_STUB)` so they run only where the stub is on.

| Tender / flow | Spec | Mechanism | Notes |
|---------------|------|-----------|-------|
| `manual_card` checkout | `sales/checkout-card.spec.ts` | stub create → UI settle-card (sync) | no webhook; closest to device-free |
| `qr_self_checkout` | `sales/checkout-qr.spec.ts` | stub PaymentLink → inject `checkout.session.completed` | assert QR renders, sale completes |
| `card_terminal` (settlement only) | `sales/checkout-terminal.spec.ts` | stub PI → inject `payment_intent.succeeded` | **UI collect is native-only**; E2E asserts server settlement + sale close, `test.skip(isMobile)` for the reader UI |
| gift-card **purchase** via card | `sales/gift-card-purchase-card.spec.ts` | manual_card tender on a gift-card line | complements existing cash `gift-cards.spec.ts` |
| appointment **deposit pay** | `calendar/deposit-pay.spec.ts` | create deposit request → inject `checkout.session.completed` (`type: appointment_deposit`) | asserts appointment→confirmed |
| deposit **refund** | `calendar/deposit-refund.spec.ts` | inject `charge.refunded` | state transition only |
| recurring **membership** renew/cancel | `sales/membership-subscription.spec.ts` | inject `customer.subscription.updated/deleted` | lead-membership status flip |
| Stripe **Connect onboarding** completion | `settings/stripe-connect.spec.ts` | inject `account.updated` (charges/payouts enabled) | asserts settings shows "connected/active" |
| `charge.refunded` on a card sale | fold into `checkout-card.spec.ts` | inject after settle | partial vs full via `amount*Cents` |

Terminal/Tap-to-Pay **card collection** (reader UI) stays OUT — native Maestro
lane (`TAB-SUITE.md` §6.D). The E2E terminal spec asserts only the
server-settlement half.

---

## 5. Env-gating & CI secrets

| Var | Where | Purpose |
|-----|-------|---------|
| `STRIPE_E2E_STUB=true` | local `.env` + preview Fly app + CI `tabs-suite` job | Flips both singleton factories to the fake; enables the `simulate-stripe-webhook` specs. **Never set on prod.** |
| `E2E_SEED_TOKEN` | already set (`TAB-SUITE.md` §3) | Auths `simulate-stripe-webhook` (safe tier) + `seed-stripe-connect` (destructive tier). |

- **No new CI secrets** — the stub uses none of the `sk_*` / `whsec_*` /
  `STRIPE_CONNECT_CLIENT_ID` vars (`packages/env/src/stripe.ts:7-21`,
  `packages/env/src/api.ts:112`). Note `apiEnv` still requires
  `STRIPE_SECRET_KEY` (`.startsWith('sk_')`) at boot; preview already supplies a
  dummy `sk_test_...` for env validation (`reference_ci_env_validation_gate`),
  and the stub means it's never actually used.
- Add `STRIPE_E2E_STUB` to `packages/env/src/api.ts` as
  `z.coerce.boolean().optional()`, defaulted off. Preview app already sets
  `E2E_DESTRUCTIVE_ALLOWED` (`testing.controller.ts:70-76`); add
  `STRIPE_E2E_STUB` alongside it in the same preview provisioning.

---

## 6. Optional real-tier smoke (nightly, NOT per-PR)

To keep the real SDK path from being 100% unexercised, a **single** nightly
job MAY run against real Stripe **test-mode** with the Stripe CLI forwarding
webhooks: one `manual_card` sale end-to-end using a test card in Elements. This
is the only place real Elements + real async webhook run. It lives in
`src/real/` (already outside the tab dirs, `TAB-SUITE.md` §2), 10-min timeout,
`test.skip` unless real `sk_test_` + `STRIPE_CONNECT_CLIENT_ID` +
`STRIPE_CONNECT_WEBHOOK_SECRET` are present. **Explicitly out of the per-PR gate**
— its flake must never block a merge. Build this only if a real bug slips past
the stub; the stub + integration + unit layers are the primary safety net.

---

## 7. Out of scope (do not build here)

- **Tap to Pay / terminal reader collection** → native Maestro lane
  (`TAB-SUITE.md` §6.D). Device-only; no browser or real-test-mode can reach it.
- **Real Connect hosted onboarding UI** → can't automate; `account.updated`
  injection covers the only state our code consumes.
- **Deeper money-math assertions** → already in unit/integration
  (`add-sale-payment.test.ts`, `settle-card-payment.test.ts`, the 9
  `_integration/*.int-spec.ts` domains). Never multiply depth through the
  browser (`TAB-SUITE.md` §2).

---

## 8. Build order (when picked up)

1. `packages/env/src/api.ts` — add `STRIPE_E2E_STUB`.
2. Stub factories (§3.B) behind the flag in
   `packages/integrations/src/stripe/{stripe,stripe-connect}.service.ts`
   `getStripe*Service()`; add a `stripe-connect.stub.ts` fake.
3. `TestingService.simulateStripeWebhook` + `seedStripeConnect` (routing lifted
   from `stripe-connect-webhooks.controller.ts:136-356`).
4. Two testing endpoints (§2).
5. `SeedHelper.simulateStripeWebhook()` / `seedStripeConnect()` in
   `apps/app-e2e/src/fixtures/seed.fixture.ts` (mirror `simulateWebhook`).
6. ~~`manual_card` spec first~~ **CORRECTION (build-time finding):** `manual_card`
   is NOT the device-free exemplar this doc assumed — `ManualCardDialog`
   (`payment-panel.tsx:343`) confirms the client secret through **real Stripe
   Elements**, which rejects the stub's fake `pi_e2e_*` secret. Driving it needs
   a *frontend* Elements bypass (a `VITE_STRIPE_E2E_STUB` branch in
   `manual-card-dialog.tsx` that skips `confirmPayment` and calls `onPaid()`
   directly) — deferred as an optional extra path. The implemented exemplar is
   **`qr_self_checkout`** (`sales/checkout-qr.spec.ts`): the QR just renders the
   fake link URL, settlement is 100% server-side via
   `POST /testing/simulate-stripe-webhook`, so no real Stripe.js runs. It also
   exercises the injection endpoint every other async tender (terminal / deposit
   / refund / subscription) depends on. Settlement needs the `salePaymentId`,
   discovered via the reusable `GET /testing/open-sale` +
   `SeedHelper.getOpenSale(orgId)`. Fan out the rest (§4) per `TAB-SUITE.md` §7,
   reusing `seedStripeConnect` / `simulateStripeWebhook` / `getOpenSale`.
7. Set `STRIPE_E2E_STUB=true` on preview + CI `tabs-suite`.
