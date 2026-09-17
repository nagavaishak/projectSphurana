# Load-test target — provision handoff

> **STATUS: NOT PROVISIONED — apply by the user.** This is the runbook to stand up the
> long-lived `borradh-api-loadtest` target the k6 harness has been waiting on since
> staging was killed. Nothing here has been run; the agent that wrote it **cannot
> provision, deploy, or hold secrets**. You need `FLY_API_TOKEN`, `NEON_API_KEY`, and a
> **cost approval** (see [Cost](#cost)) before you start.
>
> Once this target exists and `LOADTEST_API_URL` (+ the load-test org creds) are set as
> repo secrets, the daily soak/wedge cron (`.github/workflows/load-soak-cron.yml`) starts
> trending automatically, and `load-test.yml` / the future ramp gate can point at it.

This document closes the **P5 — Load revival** blocker in
[`docs/testing/release-safety-strategy.md`](../../docs/testing/release-safety-strategy.md):
> `[ ] Dedicated borradh-api-loadtest Fly app + Neon branch (infra/cost decision — blocks running any of the below for real)`

---

## Why a dedicated target (not a preview, not prod)

The harness's whole point (Pillar 3) is to reproduce **saturation** failure modes that no
functional test can: the Fly↔Neon pool wedge (API-58/63, ENG-348/347), long-lived SSE
stream exhaustion, and the 600/min rate-limit shed (ENG-251/280). Those only reproduce
against a **prod-representative** target:

- **A small, remote DB pool.** The client uses `max=10` remote connections per instance
  (`packages/database/src/client.ts`) plus `idle_in_transaction_session_timeout='10s'`. A
  fresh per-PR preview branch has a generous pool and no contention, so a wedge never
  fires — the scenario thresholds are meaningless against it (`helpers/config.js` says as
  much).
- **`NODE_ENV=production`,** so the global throttler is the real **600/min** limit
  (`apps/api/src/app/app.module.ts:108`), not the dev `10_000/min` (effectively off).
- **No `E2E_SEED_TOKEN`,** because that no-ops the Redis throttler storage entirely
  (`app.module.ts:102`) — the rate-limit-burst scenario would test nothing.
- **Isolated from prod and from previews,** so a heavy soak/wedge never touches a customer
  request path or a real customer DB.

A per-PR preview gives the cheap per-PR perf-smoke (`perf-smoke.yml`) all it needs; the
**dedicated** target is what the **daily soak/wedge trend** and the **ramp gate** require.

---

## What you're standing up

| Resource | Name | Notes |
|----------|------|-------|
| Fly app (api) | `borradh-api-loadtest` | Persistent, small, always-on, `NODE_ENV=production` |
| Neon branch | `loadtest` | Dedicated branch off `main`; pooled (PgBouncer) connection string |
| Load-test org | a real org in the `loadtest` DB | High assistant quota (or quota-exempt) for the SSE soak |
| Repo secrets | `LOADTEST_API_URL`, `LOAD_TEST_EMAIL`, `LOAD_TEST_PASSWORD` | Consumed by `load-soak-cron.yml` / `load-test.yml` |

**No worker.** The harness drives HTTP routes on the api only (`apps/load-tests/scenarios/*`
are all api requests). The video worker is out of scope — don't provision
`borradh-worker-loadtest` unless/until a queue-backlog scenario lands (it's a TODO in the
strategy). Keeping it api-only halves the cost.

This **mirrors the api deploy contract** the existing pipeline already uses
(`.github/workflows/deploy-production.yml` and `.github/workflows/pr-preview.yml`):
build-once images are tagged by git **tree-hash**, env validation runs at **boot**
(`@borradh-workspace/env`'s `createEnv()` throws on a missing var), and the api boots from
`apps/api/fly.toml` (region `lhr`, `/health/live` check, `shared-cpu-2x`/1gb). See
`apps/load-tests/fly.loadtest.toml` for the loadtest-specific machine sizing that mirrors it.

---

## Provision steps (apply by the user)

> Prereqs on your machine: `flyctl` (authed: `flyctl auth login`), `neonctl`
> (`npm i -g neonctl`, authed: `neonctl auth`), and the repo's `NEON_PROJECT_ID`
> (GitHub repo variable — Neon project `muddy-boat-31692387` per the workspace notes;
> confirm in repo settings).

### 1. Create the Neon `loadtest` branch

```bash
NEON_PROJECT_ID=<your-neon-project-id>   # the repo's NEON_PROJECT_ID variable

# Branch off main (idempotent — "already exists" is the success case on re-run).
neonctl branches create --name loadtest --parent main --project-id "$NEON_PROJECT_ID"

# POOLED (PgBouncer) connection string — this is what the running api uses, so its
# client pool survives Neon compute suspend/resume + burst load without wedging on the
# "database:down, redis:up" /health/ready 503 (see pr-preview.yml's rationale).
neonctl connection-string loadtest \
  --project-id "$NEON_PROJECT_ID" \
  --role-name neondb_owner \
  --pooled true
#   -> postgresql://neondb_owner:***@ep-***-pooler.<region>.aws.neon.tech/neondb?sslmode=require
#      Save this as DATABASE_URL on the Fly app in step 3.

# DIRECT (un-pooled) connection string — used ONLY to run migrations (DDL needs a direct
# session, not transaction-mode pooling).
neonctl connection-string loadtest \
  --project-id "$NEON_PROJECT_ID" \
  --role-name neondb_owner \
  --pooled false
#   -> save as the migration DATABASE_URL in step 4.
```

> The branch carries the RLS app roles (`app_authenticated`/`app_public`/`app_system`) if
> migration 0049 has run on `main`. The loadtest target runs **RLS-off** (owner pool) like
> the default previews — do NOT set `RLS_ENABLED`. `--role-name neondb_owner` above is
> required so `neonctl` doesn't fail with "Multiple roles found".

### 2. Create the Fly app

```bash
FLY_ORG=borradh-technologies-limited

flyctl apps create borradh-api-loadtest --org "$FLY_ORG"
# Idempotent: a "Name has already been taken" error means it exists — reuse it.
```

### 3. Set the Fly secrets

The loadtest app needs the **same env contract** as a preview api (env validation runs at
boot, so a missing var crash-loops the rollout). Pull the base config the same way the
preview workflow does — the simplest path is to copy a preview's secret set and override
the target-specific vars. The minimum the api needs to boot + serve the scenarios:

```bash
APP=borradh-api-loadtest

# DATABASE_URL = the POOLED loadtest string from step 1.
flyctl secrets set --app "$APP" \
  DATABASE_URL="postgresql://neondb_owner:***@ep-***-pooler.<region>.aws.neon.tech/neondb?sslmode=require" \
  REDIS_URL="redis://<a-loadtest-or-preview-redis>" \
  BULLMQ_KEY_PREFIX="loadtest" \
  APP_ENV="loadtest" \
  BETTER_AUTH_SECRET="<32+ char secret>" \
  BETTER_AUTH_URL="https://borradh-api-loadtest.fly.dev" \
  ANTHROPIC_API_KEY="<key — REQUIRED for the assistant-stream scenario>" \
  # ...plus every other var @borradh-workspace/env requires at boot (OPENAI_API_KEY,
  # STRIPE_*, RESEND_API_KEY, META_*, AWS_*, etc.). The authoritative list is whatever a
  # preview api boots with — see the "Load preview secrets from 1Password" +
  # "Set Fly secrets — API" steps in .github/workflows/pr-preview.yml. The fastest, least
  # error-prone path is to replicate that 1Password preview item.
```

**CRITICAL env notes for a *meaningful* load test (not just a green boot):**

| Var | Value | Why |
|-----|-------|-----|
| `NODE_ENV` | `production` | Baked into `apps/api/fly.toml [env]`. Keep it — it's what makes the throttler the real **600/min** limit (`app.module.ts:108`). Do **not** override to development. |
| `E2E_SEED_TOKEN` | **UNSET** | If set, the Redis throttler storage **no-ops** (`app.module.ts:102`) and the rate-limit-burst scenario tests nothing. Leave it unset on this target (unlike PR previews, which set it for destructive test endpoints). |
| `E2E_DESTRUCTIVE_ALLOWED` | **UNSET** | Don't open the destructive `/testing` endpoints on a persistent app. |
| `ANTHROPIC_API_KEY` | a real key | The `assistant-stream` scenario makes real model calls (cost). Without it those requests fail rather than stream. |
| `DATABASE_URL` | the **pooled** Neon string | Pooled = survives compute suspend/resume + burst; un-pooled wedges under load. |

### 4. Run migrations against the loadtest branch

Mirror the one-off migration the deploy pipeline runs — but from your machine against the
**direct** string (simplest for a one-time setup), or as a one-off Fly machine
(`deploy-production.yml`'s `migrate-db` job is the template if you'd rather not see the
connection string):

```bash
# From the repo root, against the DIRECT (un-pooled) loadtest connection string:
DATABASE_URL="postgresql://neondb_owner:***@ep-***.<region>.aws.neon.tech/neondb?sslmode=require" \
  pnpm --filter @borradh-workspace/database db:migrate
```

### 5. Deploy the api image

Reuse a **pre-built, tree-hash-tagged** api image from the Fly registry (the same images
`build-artifacts.yml` produces for every main push) — no rebuild needed:

```bash
APP=borradh-api-loadtest
# Pick a known-good main SHA's image. Tree-hash for a SHA: `git rev-parse <sha>^{tree}`.
TREE_HASH=$(git rev-parse origin/main^{tree})
IMAGE="registry.fly.io/borradh-api-prod:${TREE_HASH}"   # prod registry holds the tagged images

flyctl deploy \
  --app "$APP" \
  --config apps/load-tests/fly.loadtest.toml \
  --image "$IMAGE" \
  --strategy rolling \
  --wait-timeout 600
# Env validation runs at boot; on failure: flyctl logs --app "$APP" --no-tail | tail -60
```

> If the tagged image isn't in the registry for that tree-hash, run `build-artifacts.yml`
> for the SHA first (same as the prod deploy precondition), or `flyctl deploy` building
> from `apps/api/Dockerfile` directly.

### 6. Seed the load-test org + user

The scenarios sign in as `LOAD_TEST_EMAIL` / `LOAD_TEST_PASSWORD` and need an **active
organization** on the session (the assistant route 400s without one — see
`scenarios/assistant-stream.js`). Create the user + org through the running loadtest api's
normal sign-up/onboarding (it's isolated on the `loadtest` Neon branch), then give that org
**assistant access + high (or exempt) message quota** so the SSE soak doesn't immediately
429 on `DAILY_LIMIT`/`MONTHLY_LIMIT`.

### 7. Set the GitHub repo secrets

```bash
gh secret set LOADTEST_API_URL  --body "https://borradh-api-loadtest.fly.dev"
gh secret set LOAD_TEST_EMAIL   --body "<the seeded load-test user email>"
gh secret set LOAD_TEST_PASSWORD --body "<the seeded load-test user password>"
```

Setting `LOADTEST_API_URL` is the **single switch** that activates the daily cron: its
`resolve-target` guard no-ops while the secret is empty and starts running the moment it's
set (no workflow edit needed — see `load-soak-cron.yml`).

### 8. Verify

```bash
curl -fsSL https://borradh-api-loadtest.fly.dev/health/ready    # expect 200 healthy
# One-shot smoke from the repo (or dispatch load-test.yml with scenario=smoke):
cd apps/load-tests && \
  K6_API_URL=https://borradh-api-loadtest.fly.dev \
  K6_TEST_EMAIL=<load-test email> \
  K6_TEST_PASSWORD=<load-test password> \
  k6 run scripts/smoke.js
```

Then dispatch `.github/workflows/load-test.yml` (scenario `wedge`,
`api_url=https://borradh-api-loadtest.fly.dev`) once manually, **re-tune the placeholder
thresholds** in `helpers/config.js` against the real numbers (they're sized for a
prod-representative target but unverified), and let the daily cron take over.

---

## Cost

- **Fly app:** one always-on `shared-cpu-2x` / 1 GB machine in `lhr`
  (mirrors `apps/api/fly.toml`'s `[[vm]]`). Ballpark **~$5–10/month** for the persistent
  machine. The daily soak spins this single machine harder for ~12 min/day — no autoscale,
  no extra machines (`auto_stop_machines = "off"`, `min_machines_running = 1`).
- **Neon `loadtest` branch:** one branch's compute, mostly idle except during runs; Neon
  autosuspends idle compute. Marginal on an existing Neon plan; the branch counts against
  the project branch ceiling (the workspace already manages this — frontend-only PRs share
  `preview-shared` to stay under it).
- **Model cost (the real variable):** the `assistant-stream` scenario makes **real
  Anthropic calls** — 10 concurrent streams × ~4 min/run/day. Keep concurrency modest
  (it's already `vus: 10` in `scripts/wedge.js`) and consider a `/testing`-style echo route
  to avoid burning model spend on the soak (noted as a TODO in `assistant-stream.js`).
- **Redis:** reuse an existing preview/loadtest Redis instance; no new provisioning needed.

**Approval gate:** standing this up is the **infra/cost decision** the strategy doc flags as
blocking. Get the cost sign-off, then apply.

---

## Secrets the user must provide

| Secret / token | Where | Purpose |
|----------------|-------|---------|
| `FLY_API_TOKEN` | your shell (provisioning) | `flyctl apps create` / `secrets set` / `deploy` |
| `NEON_API_KEY` | your shell (provisioning) | `neonctl branches create` / `connection-string` |
| `LOADTEST_API_URL` | **GitHub repo secret** | Activates `load-soak-cron.yml`; the cron no-ops until it's set |
| `LOAD_TEST_EMAIL` | **GitHub repo secret** | k6 sign-in (`helpers/auth.js`) — already consumed by the existing workflows |
| `LOAD_TEST_PASSWORD` | **GitHub repo secret** | k6 sign-in |
| Fly app env (boot) | Fly secrets on `borradh-api-loadtest` | Full `@borradh-workspace/env` contract; replicate the 1Password preview item |

The k6 workflows already reference `secrets.LOAD_TEST_EMAIL` / `secrets.LOAD_TEST_PASSWORD`
and `secrets.LOADTEST_API_URL` — **no workflow change is needed** to consume them; setting
the secrets is sufficient.

---

## Iteration findings (2026-06-16 — verified against the live target)

What running the heavy suite against `borradh-api-loadtest` actually taught us:

- **Auth needs an explicit cookie AND an active org.** k6's auto cookie jar drops the
  `__Secure-`/SameSite=None Better Auth token, so every authed request resends it
  explicitly (`helpers/auth.js` `sessionCookieHeader()`). The session also needs an
  **active organization** or org-scoped reads 400 — set via `POST /organization/active`
  (`signInAndSetActiveOrg()` in setup). The heavy scripts sign in **once** in `setup()`
  and share one cookie across all VUs (the sign-in route is throttled 30/15min per IP).
- **The throttler is per-route, per-IP.** The global 600/min (=10/s) limit applies to
  *each* route+IP independently (NestJS keys it per handler). `GET /` trips at 600/min;
  `/leads` and `/leads/stats` each have their own 600/min bucket.
- **A single IP cannot wedge the DB pool here** — see the three walls in
  `scenarios/pool-saturation.js`. `pool_saturation` runs at the box's sustainable
  `K6_POOL_RATE=10/s` (clean: p95 ~0.3s); 25/s → p95 ~12s, 50/s → timeouts + a machine
  restart. Real wedge coverage (**PRD-46**) is now the dedicated
  `scripts/pool-wedge.js` + `POST /testing/db-pool-hold` endpoint — see below.

### Pool-wedge verifier (PRD-46 — `scripts/pool-wedge.js`)

Verifies the idle-in-transaction reaping guard (every `db.transaction()` sets
`idle_in_transaction_session_timeout = '10s'`, `packages/database` client.ts) against
the REAL pooled target — the orphaned-transaction wedge must SELF-HEAL, not starve the
pool. `POST /testing/db-pool-hold` opens N idle transactions and reports how many the
guard reaped; the script asserts `reaped === requested` via an idle-in-transaction error.

This is a **separate phase**, not part of the per-PR/cron load runs, because:
1. The endpoint is destructive-gated → needs `E2E_SEED_TOKEN` set on the target, which
   **also no-ops the throttler** (so it can't run alongside the rate-limit/volume scenarios).
2. It only exists once the loadtest app runs an image built from a branch that includes it
   (the app runs a **pinned** image — redeploy it to the new image first).

```bash
# 1. Redeploy the loadtest app to an image that includes the endpoint (this branch).
# 2. Temporarily enable the token (see seed-loadtest-user.sh for the enable/disable dance):
flyctl secrets set --app borradh-api-loadtest E2E_SEED_TOKEN="<token>" E2E_DESTRUCTIVE_ALLOWED=true
# 3. Run the verifier:
cd apps/load-tests && K6_API_URL=https://borradh-api-loadtest.fly.dev \
  K6_SEED_TOKEN="<same token>" k6 run scripts/pool-wedge.js
# 4. Disable again (re-arms the throttler for the volume scenarios):
flyctl secrets unset --app borradh-api-loadtest E2E_SEED_TOKEN E2E_DESTRUCTIVE_ALLOWED
```

Without `K6_SEED_TOKEN` the script skips cleanly (green). Default 4 idle conns stay below
the pool max (box stays responsive); set `K6_WEDGE_CONNECTIONS` ≥ 10 to also reproduce
full pool exhaustion.
- **`meta_sync_load` is observe-only** on this org (no Meta integration → clean 412,
  short-circuits before the write path). **`queue_backlog` is observe-only** unless the
  repo var `LOADTEST_VIDEO_ID` points at a real render-ready video.
- **`assistant_stream` is the only paid scenario** (real Anthropic). The per-PR push
  workflow (`load-test-pr.yml`) skips it via `K6_SKIP_ASSISTANT=true` so pushes cost $0;
  manual `workflow_dispatch` + the daily cron run it. The org needs assistant access +
  quota (force-subscription) or it 429s — those 429s are treated as expected, not failures.
- **k6 install in CI** uses the GitHub release tarball, not the apt+gpg keyserver (the
  keyserver fetch is flaky on runners → `k6: command not found`).
- **`docs(load): flagged bug`** — `POST /webhooks/billing` returns **500**, not 400, on a
  bad/missing Stripe signature (over-narrow `'No signatures found'` match in
  `handle-stripe-webhook.service.ts`). Out of scope here; for the features owner.

### ⚠️ The loadtest Neon branch currently holds real PROD PII (being fixed)

The `loadtest` branch was provisioned as a **copy-on-write copy of `main`/prod data**, so
right now the load runs read (and the seeded user lives alongside) **real customer PII** —
treat the target as prod-data-sensitive until the refresh below lands.

**Decided (PRD-47):** replace this with a **weekly anonymized refresh** — dump prod → scrub
all PII + secrets (emails/names/phones/addresses/message content/credentials/tokens) while
preserving volume, shape, and referential integrity → restore into the loadtest branch.
No raw prod PII on the load-test box once that job ships. See PRD-47 for the plan.
