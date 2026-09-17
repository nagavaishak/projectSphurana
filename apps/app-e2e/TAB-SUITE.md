# Tab-Organized E2E Suite — Status & Continuation Plan

> Handoff doc for the fresha-clone test effort. Written so a fresh session (or a
> human) can resume without re-discovering anything. Branch: `feat/fresha-clone`.
> Companion: the strategy artifact (broad-E2E direction, §11 remaining-work,
> §12 tab reorg) and the `project-fresha-test-strategy` memory.

---

## 1. Status (what's done, committed)

| Commit | Contents |
|--------|----------|
| `21f47f57c` | **W0c** 5 payment-service unit gaps (30 tests) + **W1** 9 API-integration domains (61 tests) + 2 hardening fixes |
| `9b7162a88` | Per-test-org E2E foundation + 7-tab desktop sweep (~51 tests) + org-id `.uuid()`→`.min(1)` fix |
| `1369f9636` | CI `tabs-suite` job (runs sweep vs per-PR preview) |
| `5f83a2e2c` | Mobile-viewport infra (helpers, `tabs-mobile` project, fixture device-forwarding, catalog reference) |
| `09e394e8a` | All tabs retrofitted to run at BOTH viewports + CI runs both projects |

**Test inventory now:**
- **Unit** (`packages/features/src/**/*.test.ts`, vitest): ~all new fresha services + the 5 previously-untested payment services. Run: `pnpm --filter @borradh-workspace/features exec vitest run <path>`.
- **API integration** (`apps/api/src/_integration/*.int-spec.ts`, jest + Testcontainers): 9 fresha domains (timesheets, sales, memberships, gift-cards, inventory, inventory-taxonomy, deposits, payments-infra, scheduling). Run: `pnpm --filter @borradh-workspace/api test:integration -- <name>`. Needs Docker.
- **E2E** (`apps/app-e2e/src/{tab}/*.spec.ts`, Playwright): 7 tabs (catalog, team, settings, home, clients, calendar, sales), each running at desktop (`tabs`) AND mobile (`tabs-mobile`). ~51 tests × 2 viewports minus documented skips/fixmes.

---

## 2. Architecture

### Layers (Testing Trophy, broad-E2E direction chosen by the user)
- Unit = business-logic branches (money math, state machines, validation).
- Integration = HTTP→service→**real DB**→RLS; org-isolation, auth-guard, DTO 400s, money-state transitions. The layer E2E can't assert.
- E2E = broad-but-shallow, one happy-path spec per UI surface, per-test-org, seeded via the real API. **Depth stays in unit/integration — never multiplied through the browser.**

### E2E organization — two axes (see strategy §12)
- **Product axis = directory + tag.** One `src/{tab}/` dir per sidebar tab: `calendar sales catalog clients team settings home inbox`. NOT tabs (deliberately outside): `auth/ smoke/ journeys/ real/` (cross-cutting), `_public` (customer booking, if added).
- **Execution axis = Playwright project.** `tabs` (Desktop Chrome) + `tabs-mobile` (Pixel 7). Both match the same tab dirs. No shared storageState, no setup dependency — the fixture provisions a fresh org per test.
- The existing `authenticated` project **excludes** the tab dirs (testIgnore) so specs run once, in `tabs`/`tabs-mobile`.

### Per-test-org fixture — `src/fixtures/org.fixture.ts`
Each test gets `org: { orgId, userId, email, password, page, seed }` — a fresh, verified, **paid**, signed-in org, order-independent + fullyParallel. Sequence inside the fixture:
1. `browser.newContext({ ...contextOptions, baseURL })` — **must** spread `contextOptions` or the mobile project silently renders desktop.
2. `seed.createEmptyVerifiedOrg(testInfo.title)` — API signup → email-verify (**navigates `page`**, so the fixture needs a real page) → create-org → force-verify. Returns `sessionToken`.
3. `seed.signInUser(email, password)` — real UI sign-in → sets the better-auth cookie.
4. `POST /organization/active { organizationId }` — a brand-new API-created org is NOT auto-active; without this, org-scoped endpoints 400 "No active organization selected".
5. `seed.forceCreateSubscription(orgId)` — most surfaces are paywalled ("A paid plan is required"); make the org paid by default.
Cleanup: global-teardown reaps `e2e.test.%` users (cascades to their orgs). The `e2e_test_` **org-id** prefix is NOT used by the primary reaper (email cascade), but IS used by a secondary id-prefix reaper (testing.service.ts ~1885).

### Mobile-viewport parity — `src/fixtures/app.ts` (THE pattern for "same flow, both viewports")
- ONE spec per flow, run through both projects. No duplicated files.
- `gotoSurface(page, path)` = navigate + `expectAppReady` (viewport-agnostic shell check).
- `expectAppReady` = `.or()` of three: desktop `[data-sidebar="menu-button"]`, mobile `<nav aria-label="Main">` (bottom-tabs), and the robust fallback `[data-slot="sidebar-inset"]` (the `<main>` every authed route renders at both viewports — needed because the mobile bottom-tab nav only renders for routes in the bottom-tab list; `team/*` etc. are not).
- `isMobile(page)` = viewport width < 768.
- **Assert on CONTENT** (`getByText(seededName)`, headings, labels), never on chrome.
- Genuinely desktop-only surfaces → `test.skip(isMobile(page), '<reason>')`.

---

## 3. How to run locally (CRITICAL — read before running E2E)

**E2E MUST target the HTTPS Cloudflare tunnel, NOT localhost http.** Over http the better-auth session cookie is `better-auth.session_token` (no `__Secure-` prefix) and `:5173→:3000` is cross-origin → cookie-authed seeding 401s. The tunnel gives HTTPS + a shared parent domain so the `__Secure-` cookie flows to the API subdomain.

Prereqs (all were up during the build):
- `docker compose up -d` (postgres + redis) — root `docker-compose.yml`.
- Local API + app dev servers running (`pnpm dev:api`, `pnpm dev` in apps/app) reachable via the tunnel.
- Cloudflare tunnel (`~/.cloudflared/config.yml`): `api.daniel.borradh-dev.com`→:3000, `app.daniel.borradh-dev.com`→:5173.
- Local DB migrated to committed head: `pnpm db:migrate` (the running API imports `features`/`database` from built **dist**, and uses `nest start --watch` on its own src only — a `packages/*` source change needs a features rebuild + API restart to take effect locally).

`apps/app-e2e/.env.test` (gitignored — recreate it):
```
BASE_URL=https://app.daniel.borradh-dev.com
API_URL=https://api.daniel.borradh-dev.com
E2E_SEED_TOKEN=<from root .env>
SKIP_WEBSERVER=true
```

Run commands:
```bash
# one tab, both viewports
pnpm --filter @borradh-workspace/app-e2e exec playwright test \
  --project=tabs --project=tabs-mobile src/catalog --workers=2 --reporter=list
# whole tab suite, desktop only
pnpm --filter @borradh-workspace/app-e2e exec playwright test --project=tabs --workers=4
# list without running (validates config)
pnpm --filter @borradh-workspace/app-e2e exec playwright test --project=tabs --list
```
Be **gentle**: the local dev server is shared with a concurrent window (booking-scalability WIP). Use low `--workers`, don't restart the shared API.

---

## 4. Hard-won learnings & gotchas (do not re-discover)

1. **HTTPS tunnel required for E2E** (§3). localhost http → 401 on all cookie seeding.
2. **Fresh org isn't active** → must `POST /organization/active` in the fixture.
3. **Paywall** → `forceCreateSubscription` in the fixture; timesheet clock-in, blocked-time-types, settings details all gated.
4. **org-id `.uuid()` mismatch** — `/testing/create-org` mints `e2e_test_<uuid>` (not a valid uuid); `getOrganizationSchema`/`getOrganizationMembersSchema` validated `.uuid()` → `GET /organizations/:id[/members]` 400s forever, wedging any provider that loads org members (the calendar grid's `AppointmentsProvider`, settings Details). **Fixed** by relaxing both to `.min(1)` (matches `getOrganizationBrandSchema`). Local API runs old dist → the 4 tests still `fixme` locally; they clear on a fresh CI/preview build.
5. **API uses built dist, not source** — `packages/features` change needs rebuild + API restart to reflect locally. Don't restart the shared API.
6. **Local DB drift** — it was behind committed migration `0076`; `pnpm db:migrate` (all migrations committed, drizzle folder clean) caught it up. If org insert 400s on unknown columns, migrate.
7. **Mobile chrome ≠ desktop** — sidebar rail collapses; bottom-tab nav only on bottom-tab routes. Use `expectAppReady`'s `sidebar-inset` fallback + content assertions.
8. **Fixture forwards contextOptions** — required for `tabs-mobile` to actually be mobile.
9. **Fixture flake** — `createSession` "Invalid email or password" race under concurrency (signup→verify→session timing). CI `retries: 2` absorbs it. Hardening = retry `createSession` (see §6).
10. **Shared index hazard** — a concurrent window stages files. ALWAYS `git add <explicit paths>` then verify `git diff --cached --name-only` has no strays before committing. Never `git add -A`.
11. **Integration harness already existed** (`apps/api/src/_integration/harness.ts` + `global-setup.ts`) — Testcontainers PG+Redis, per-controller Nest app + supertest, real guards/services/DB, `FakeAuthGuard`. Per-domain seed helpers go in `_integration/seeds/{domain}.ts` (NOT harness.ts — avoids parallel-write conflicts). Guard enforcement varies per controller (RoleGuard on route vs in-service) — read each and assert what's real.

---

## 5. File map

```
apps/app-e2e/
  playwright.config.ts        # `tabs` + `tabs-mobile` projects; tab dirs excluded from `authenticated`
  .env.test                   # gitignored — tunnel HTTPS (recreate per §3)
  src/
    fixtures/
      org.fixture.ts          # per-test-org fixture (the backbone)
      app.ts                  # gotoSurface / expectAppReady / isMobile
      seed.fixture.ts         # SeedHelper (pre-existing) — createEmptyVerifiedOrg, createService, authenticatedApiCall, ...
    catalog|team|settings|home|clients|calendar|sales/   # one dir per sidebar tab
apps/api/src/_integration/
  harness.ts, global-setup.ts, *.int-spec.ts, seeds/{domain}.ts
.github/workflows/e2e.yml # `tabs` matrix suite (both projects); the advisory `quarantine` suite covers @quarantine tab specs
```

---

## 6. Remaining work (actionable, prioritized)

### A. Un-fixme the 4 org-id-blocked tests  — SMALL, do first once CI confirms
Calendar grid ×3 (`src/calendar/calendar.spec.ts` — new-appointment dialog, block-off dialog, seeded-appointment+details) and settings Details ×1 (`src/settings/details.spec.ts`). They were `test.fixme` due to the org-id `.uuid()` block, which is **fixed** in `9b7162a88`. After a preview build (or a local features rebuild + API restart) confirms `GET /organizations/:id/members` accepts the `e2e_test_` id, remove `.fixme` and verify at both viewports. Calendar grid ones also need built-in booking enabled (`primaryCalendarType: 'borradh'`) — check the org default.

### B. Real-Stripe tier (card / terminal / subscription)  — MEDIUM, needs a decision
Cash covers checkout breadth today (`sales/checkout.spec.ts` uses cash tender). NOT covered: `card_terminal` / `manual_card` / `qr_self_checkout` tenders, Stripe settlement, recurring-membership subscription, deposits pay, gift-card *purchase* via card, Stripe Connect onboarding completion.
- **Decision needed**: env-gated Stripe stub (test-mode + deterministic webhook injection) vs a thin real-Stripe-test-mode tier. Lean = stub for breadth + a few real-tier money journeys so stubbing can't hide a real bug.
- The stub seam is the only net-new backend piece. Terminal/Tap-to-Pay card path is device-only → belongs in native (§D), not here.

### C. Fixture hardening (`createSession` retry)  — SMALL
In `SeedHelper.createSession` (or wrap in `org.fixture`), retry once on the "Invalid email or password" race (the signup/verify hasn't propagated). Removes the main source of local/CI flake. Verify a few parallel runs stay green without relying on `retries`.

### D. Native Maestro lane  — LARGE, separate infra
The browser-unreachable surfaces (all `Capacitor.isNativePlatform()`-gated dead code in a browser): **Tap to Pay** (Stripe Terminal simulated reader), **calendar touch-drag** (`react-dnd-multi-backend` TouchBackend), **camera/photo picker**, **push permission**, deep links. Lives in `apps/app/.maestro/` + `mobile-e2e.yml` (Android emulator). Per-PR gate stays tiny (boot + sign-in + 1 money flow); heavy flows nightly. Needs an emulator (may not be available in a headless session). See memory `project_mobile_e2e_detox`, `reference_capacitor_runtime_config_cors`.

### E. Product gap found (ticket, not a test)
**No responsive mobile POS checkout.** `apps/app/src/features/sales/components/checkout/checkout-flow.tsx` is fixed-width desktop (`w-[76vw]` sheet + `w-[360px]` cart → cart wider than sheet at 412px, step controls clip). `sales/checkout.spec.ts` is `test.skip(isMobile)`. A responsive/mobile POS flow is a product task; once it exists, remove the skip.

### F. Coverage extensions (optional)
- Inbox as its own tab dir (currently under `clients/`).
- Deeper flows per surface only if a real bug motivates it — remember depth belongs in unit/integration, not more E2E.

### Integration/unit follow-ups already noted (non-blocking)
- The pre-existing `appointment-double-booking.int-spec.ts` (2 tests) fails until the booking-scalability window commits its exclusion-constraint migrations — not ours.

---

## 7. Fan-out playbook (how this was built — repeat for new tabs/lanes)

Exemplar-first, then parallel agents:
1. Build + verify ONE reference (catalog for E2E, timesheets for integration) end-to-end, in-loop, against the real stack. Fix all foundation bugs here — do NOT fan out onto a broken foundation.
2. Fan out **one agent per tab/domain**, each: reads the reference + `org.fixture`/`app.ts`, writes only its own dir, seeds via `org.seed.*` / `authenticatedApiCall`, verifies green at both projects, uses `test.skip(isMobile)` for real divergence, never weakens assertions, reports findings, no commit.
3. Batch 2–3 agents at a time (shared dev server). `--workers` low.
4. Coordinator commits, staging explicit paths only (§4.10).
