# Connected per-test-org isolation — migration plan

> **SUPERSEDED (2026-06-24):** The serial bottleneck this plan targets —
> `src/chatbots/targeting.connected.spec.ts` and the `updateChatbotTargeting`
> helper — was **removed** when the `newLeadsOnly` / `adLeadsOnly` targeting
> feature was deleted (Claire now classifies leads semantically). The
> "convert first" target and the shared-`chatbotSettings`-targeting rationale
> below no longer exist. The per-test-org isolation idea may still apply to the
> *other* connected specs that mutate shared org state (system prompt, calendar
> type — see "Which specs convert first" item 2), so this is kept for reference;
> revise or delete once that is decided.

Status: **PLAN ONLY.** No spec is rewritten here. Nothing in this plan can be
proven green without running it against the live connected Meta org (see
[Why this can only be verified live](#why-this-can-only-be-verified-live)).
Pillar 2 of `docs/testing/release-safety-strategy.md`.

## The problem

The connected suite's `connected-chatbot` project is forced serial
(`fullyParallel: false`, run with `--workers=1`) in
`apps/app-e2e/playwright.config.ts` (lines 256–275). The reason is a single
file: `src/chatbots/targeting.connected.spec.ts`.

That spec mutates **shared org state**. Every test case calls

```ts
await s.updateChatbotTargeting(orgId, { newLeadsOnly, adLeadsOnly });
```

against the one shared connected org (`orgId` resolved once in `beforeAll` from
`.auth/connected-user.json`). `updateChatbotTargeting` →
`PUT /testing/update-chatbot-settings`, which writes `organization.chatbotSettings`.
A second test running in parallel would flip those flags out from under the
first between its `simulateWebhook` and its `getConversationStatus` assertion.
So the whole file — and, because Playwright's parallelism granularity for
shared-state safety is the *project*, the whole `connected-chatbot` project —
runs one worker, one file at a time.

Concretely the bottleneck is **14 cases** in `targeting.connected.spec.ts`
(3 active under `both targeting off` + `newLeadsOnly on`; 11 more under two
`test.describe.skip` blocks — `adLeadsOnly on` and `both targeting on` — parked
because the `adLeadsOnly` backend gate is commented out, commit `ebe0c809`).
Each active case sets targeting, fires a webhook, waits 500 ms, asserts status.
Serial, that's the long pole of the connected run. If each case owned its own
org with its own `chatbotSettings`, the file could be `fullyParallel: true`.

## Why each case is forced serial (the shared-state dependency)

`targeting` is per-**org**, not per-conversation. The tests already isolate the
*conversation* dimension correctly — each uses a unique
`senderId = e2e-targeting-${Date.now()}-${label}`, so conversations never
collide. The only thing they share is the org's targeting flags. Give each case
its own org and the shared dimension disappears.

## What an isolated case needs

A connected-chatbot test needs an org that has, at minimum:

1. A **verified organization** row (so the chatbot pipeline treats it as live).
2. A **Meta integration + page binding** so `simulateWebhook({ pageId })` routes
   the inbound message to *this* org's chatbot. Today this is
   `TEST_META_PAGE_ID` — one shared real Facebook Page.
3. **Chatbot enabled** for that page (`ensureChatbotEnabled(pageId)`).
4. Targeting flags set to the case's permutation.

(1), (3) and (4) are cheap idempotent DB writes via existing testing endpoints.
(2) is the hard part and the reason for the live-only caveat below.

## Existing primitives we can build on

From `src/fixtures/seed.fixture.ts` + `apps/api/src/testing/testing.controller.ts`:

| Need | Existing endpoint / helper | Notes |
|------|----------------------------|-------|
| Create user | `POST /auth/sign-up` (`signUpViaApi`) | already used |
| Verify user email | `POST /testing/force-verify` (`forceVerifyUser`) | |
| Find a user's org | `GET /testing/organization-by-email` (`getOrganizationByEmail`) | |
| Verify an org | `POST /testing/force-verify-org` (`forceVerifyOrganization`) | |
| Seed Meta page/integration | `POST /testing/seed-meta-ads` (`seedMetaAds`) | takes `{ organizationId, connectedById, accessToken, pageId, pageName?, adAccountId?, adAccountName? }` → writes a `meta_integration` row binding the org to `pageId` |
| Seed WhatsApp | `POST /testing/seed-whatsapp` (`seedConnectedWhatsAppAccount`) | per-org idempotent |
| Enable chatbot for a page | `POST /testing/ensure-chatbot-enabled` (`ensureChatbotEnabled`) | |
| Set targeting | `PUT /testing/update-chatbot-settings` (`updateChatbotTargeting`) | |
| Create session for storageState | `POST /testing/create-session` (`createSession`) | bypasses UI sign-in |
| Drive a chatbot turn | `POST /testing/simulate-webhook` (`simulateWebhook`) | routes by `pageId` |
| Read conversation status | `GET /testing/conversation-status` (`getConversationStatus`) | |

**There is no org-creation helper today** (grep for `createOrg|EmptyVerifiedOrg`
in the fixture returns nothing). That is the first new helper to build.

## New helpers needed

### 1. `SeedHelper.createEmptyVerifiedOrg(label)` — new

A pure-API org provisioner (no UI, no onboarding wizard):

```
createEmptyVerifiedOrg(label): Promise<{ orgId, userId, email, password, sessionToken }>
```

Steps, all via existing endpoints:
1. `signUpViaApi({ name, email: `e2e.test.connected.${label}.${Date.now()}@example.com`, password })`
   — note the `e2e.test.%` prefix so `POST /testing/cleanup` reaps it.
2. `forceVerifyUser(email)`.
3. Create the org. **Gap:** there is no `POST /testing/create-org`. Options:
   a. Add a thin `POST /testing/create-org` endpoint that calls the org-create
      feature service with a minimal payload (name, businessType) and returns
      `{ organizationId }`. Preferred — deterministic, no wizard.
   b. Reuse `completeOnboarding()` via the UI. Rejected — slow, flaky, defeats
      the parallelism win.
4. `forceVerifyOrganization(orgId)`.
5. `createSession(email, password)` → `sessionToken` for `storageState`.

This helper is reusable by the bare suite too (it currently leans on a single
pre-provisioned bare org).

### 2. `SeedHelper.seedConnectedMetaForOrg(orgId, userId, pageId)` — thin wrapper

Wraps `POST /testing/seed-meta-ads` with the connected creds (a real Meta
system-user `accessToken` + a `pageId`). Plus `ensureChatbotEnabled(pageId)`.
Idempotent. This is where the **shared-Meta-page constraint** bites (next
section).

### 3. A per-test fixture (Playwright `test.extend`) — new

```ts
// src/fixtures/connected-org.fixture.ts
export const test = base.extend<{ connectedOrg: ConnectedOrg }>({
  connectedOrg: async ({ browser, request }, use, testInfo) => {
    const seed = new SeedHelper(<page>, request);
    const org = await seed.createEmptyVerifiedOrg(slug(testInfo.title));
    await seed.seedConnectedMetaForOrg(org.orgId, org.userId, PAGE_ID_FOR(testInfo));
    await seed.seedWhatsAppForOrg(org.orgId, org.userId); // optional
    await use(org);
    // teardown: POST /testing/cleanup by this org's e2e.test.% email
  },
});
```

Each test gets a fresh `org` with its own `chatbotSettings`, so
`updateChatbotTargeting(org.orgId, …)` is private to that test → safe to
`fullyParallel: true`.

## Which specs convert first

1. **`src/chatbots/targeting.connected.spec.ts` — convert first.** It is the
   serial bottleneck, it only shares the org's targeting flags (every other
   dimension is already isolated by `senderId`), and its assertions are fast
   (status read, not full bot response). Highest ROI, lowest blast radius.
   After conversion, drop it from `connected-chatbot` into a new
   `fullyParallel: true` `connected-chatbot-parallel` project (or flip the whole
   project parallel once it is the last serial dependant).

2. **The rest of `src/chatbots/*.connected.spec.ts`** that mutate shared org
   state (system prompt, calendar type — see the `connected-chatbot` project
   comment, config lines 256–259). Convert one file at a time; keep the serial
   `connected-chatbot` project alive until every file in it is migrated, then
   delete the serial project.

3. **Do NOT convert `src/ads/*.connected.spec.ts`.** Their serialism is a
   *Meta-rate-limit* constraint (config lines 231–254: user-level rate limit
   code 17), not a shared-DB-state constraint. Per-org isolation does not help —
   the rate limit is per Meta *user/ad-account*, which the seeded orgs still
   share. Leave `connected-ads` serial.

## Risks

1. **Shared Meta page (the central risk).** `simulateWebhook` routes by
   `pageId`. If N parallel test-orgs all `seed-meta-ads` the *same*
   `TEST_META_PAGE_ID`, the inbound webhook can no longer deterministically pick
   which org's chatbot handles it (two `meta_integration` rows now claim the same
   page). True parallelism therefore needs **one real Meta Page per parallel
   worker** — a scarce, manually-provisioned Meta asset (`TEST_META_PAGE_ID_1..N`).
   Without distinct pages, the orgs are isolated in the DB but *not* in the
   routing layer, and the tests would cross-talk. This must be confirmed against
   the real Meta routing — it cannot be reasoned about from code alone.
2. **Org-create endpoint surface.** Adding `POST /testing/create-org` widens the
   testing controller. It must stay behind the existing `validateSeedToken` +
   `NODE_ENV !== 'production'` guards, same as every other `/testing/*` route.
3. **Cleanup volume.** Per-test orgs multiply rows (org, user, meta_integration,
   conversations). Teardown must reap by the `e2e.test.%` email prefix every run,
   or staging accretes orphaned connected orgs. A failed teardown leaks a
   verified org with a real Meta binding.
4. **Provisioning cost per test.** Each isolated case now pays sign-up +
   verify + org-create + meta-seed before its assertion. For 14 fast cases this
   may erase part of the parallelism win if provisioning is slow; measure
   wall-clock before/after. Mitigation: provision orgs once per *worker*
   (`worker`-scoped fixture) and reset only `chatbotSettings` per test — but that
   re-introduces a (smaller) shared-state surface, so weigh carefully.
5. **Meta token lifetime.** `seed-meta-ads` needs a real, ideally never-expiring
   system-user `accessToken`. If it expires, every per-org seed fails at once.
6. **Setup-connected divergence.** `setup-connected.ts` still owns the canonical
   shared connected org + WhatsApp + campaign seed. The new fixture must not
   fight it (e.g. don't reuse the same Meta page binding in a way that collides
   with the parallel `connected` project still using the shared org).

## Why this can only be verified live

The whole value of this change is that the chatbot pipeline routes a real
inbound webhook to the right org's chatbot **by Meta page id**. That routing,
the `seed-meta-ads` binding's validity against a real Meta system-user token,
and whether N distinct real Meta Pages actually disambiguate N parallel orgs are
all behaviours of the **live connected Meta integration** — there is no mock.
The `simulateWebhook` endpoint exercises the real `handleIncomingMessage`
pipeline against real `meta_integration` rows. A green run on a fresh Postgres
(the migration-smoke style) would prove nothing here, because it has no real
Meta page to route to. Hence: ship behind a branch, run
`--project=connected-chatbot --workers=4` against the live connected org +
real Meta Pages, and confirm zero cross-talk before deleting the serial project.
The team relies on this suite, so the unverified refactor is deliberately **not**
written here.

## Migration checklist (when greenlit, against the live org)

- [ ] Add `POST /testing/create-org` (guarded) + `createEmptyVerifiedOrg` helper.
- [ ] Provision `TEST_META_PAGE_ID_1..N` (one real Page per worker) — Meta-side.
- [ ] Add `connected-org.fixture.ts` (`test.extend`, per-test org + teardown).
- [ ] Convert `targeting.connected.spec.ts` to the fixture; assert each case
      reads only its own `org.orgId`.
- [ ] Move it to a `fullyParallel: true` project; run `--workers=N` live.
- [ ] Confirm zero cross-talk + measure wall-clock vs the serial baseline.
- [ ] Migrate remaining `src/chatbots/*.connected.spec.ts`, then delete the
      serial `connected-chatbot` project. Leave `connected-ads` serial.
