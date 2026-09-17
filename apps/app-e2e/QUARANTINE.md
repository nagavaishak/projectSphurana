# Flake budget & quarantine lane (app-e2e)

Pillar 2 of [`docs/testing/release-safety-strategy.md`](../../docs/testing/release-safety-strategy.md).

We ship to prod on **CI-green, many pushes a day, no staging gate**. So the E2E
gate must stay *trustworthy*: a flaky test must never block a good push, and a
flaky test must never be retried-into-green and silently mask a real
regression. That is what the quarantine lane buys.

## The rule

**Quarantine is temporary.** A `@quarantine` tag is a loan against the gate's
trust, not a place tests go to die. Every quarantined spec needs an owner and a
deadline to be fixed-or-deleted.

## How to quarantine a flaky spec

1. Add the literal tag **`@quarantine`** to the test (or `describe`) **title**:

   ```ts
   test('uploads a video on a slow preview @quarantine', async ({ page }) => {
     // ...
   });
   ```

   Playwright's `--grep` / `--grep-invert` match against the full title, so the
   tag routes the spec between the required and advisory lanes (below). No
   config or per-file annotation is needed — the tag in the title *is* the
   mechanism.

2. Directly above the test, add a one-line comment with **all three** of:
   - a link to the **tracking issue** (Linear),
   - an **owner** (who fixes it),
   - a **re-enable deadline** (a date — quarantine is temporary).

   ```ts
   // @quarantine — flaky on preview, ~15% fail. ENG-XXX. Owner: @dcerasi.
   // Re-enable by 2026-07-01 or delete.
   test('... @quarantine', async ({ page }) => { /* ... */ });
   ```

3. Open / link the tracking issue so the flake is visible and owned.

That is the whole loop. The next CI run automatically routes the spec out of
the required gate and into the advisory job.

## Currently quarantined

| spec | project | why | resolution |
|---|---|---|---|
| `videos/upload-procedure-videos.spec.ts` | `authenticated` | upload to S3 intermittently fails; trips its own "assets never reached S3" guard. Flaky on BOTH lanes. | still quarantined — advisory lane. PR #895 rewrites this spec for background tagging but does NOT touch the upload assertion — two distinct flakes. Re-assess the upload flake once #895 lands. |

## Recently de-quarantined

Kept here rather than deleted, because in three of the four cases the *symptom*
on file was accurate and the *diagnosis* next to it was not. That is the failure
mode worth remembering: a quarantine note is written at the moment of least
information, and it then gets read as settled fact by everyone who comes after.

| spec | what the note said | what it actually was |
|---|---|---|
| `settings/website-scan.spec.ts` › "a scoped scan diffs row by row…" | CI-only; the cold crawl of a bot-protected site overran the wait for `Services & prices` | the symptom was right, the cause was named too narrowly. It was not the site being bot-protected: the spec did a real crawl through the whole scraping fan-out plus a GPT extraction, on **every push**, and **twice** (`tabs` and `tabs-mobile`), against a 120s budget. **Relocated** by #943 to `src/real/settings/` (nightly `real-e2e`, 240s, no retries) — the same treatment, for the same reason, as the onboarding spec above. What stays on the gate is the half that fetches nothing. De-quarantined 2026-08-31: the tag is gone and the test it named no longer exists on the gate. |
| `journeys/onboarding-website-analysis.spec.ts` | slowest spec in the bare suite; only green on a retry | true, and inherent: it crawled a real third-party clinic site through the full paid scraping + AI pipeline. **Relocated** to `src/real/onboarding/` (nightly `real-e2e`) and repointed at `clinic-fixture.html`, a fixture we commit and publish ourselves. |
| `ads/create-campaign.connected.spec.ts` | `getPlace()` returns without `address_components`, so `address-autocomplete.tsx` returns silently | the app was never involved. That input is `components/app/city-search.tsx` and its guard is `place.geometry`, not `address_components`. An isolated repro against the same key rendered four predictions for "Dublin" — but `ArrowDown` never highlights one under Playwright (`.pac-item-selected` stays at 0, via `locator.press` *and* `page.keyboard.press`), so `Enter` committed nothing and `place_changed` never fired. **Clicking** the prediction returns full geometry. A test bug. |
| `ads/render-to-live-ad.connected.spec.ts` | video never leaves `draft`, so the job is never enqueued — an idle worker / consume gap | the worker is acquitted by the symptom itself: a successful export sets `status='queued'` *before* it enqueues, so `draft` means the export never succeeded. `POST /videos` does not enqueue anything — `POST /videos/:id/export` does. The spec watched only the create, so a rejected export (bad status, incomplete `draftConfig`, b-roll still transcoding) was invisible and became an 8-minute silent timeout. It now waits on the export and reports its rejection. |

### If you are about to write a quarantine note

Say what you **observed** and what you **checked**, and mark anything else as a
guess. All three notes above stated a cause in the indicative mood; all three
were wrong, and each one sent the next reader at the wrong file. "Video sits at
`draft` for the full 8m" is worth writing down. "So the worker never consumed
it" was worth an hour of someone's time.

## Closed: the advisory lane now covers the connected projects

It used to run only `auth-tests`, `authenticated`, `authenticated-mobile`,
`admin-tests`, `journey-tests`, `tabs` and `tabs-mobile` — so tagging a spec in
`connected`, `connected-ads` or `connected-chatbot` **disabled it**: the required
lane dropped it via `--grep-invert` and the advisory lane never picked it up.

The `quarantine` suite in `e2e.yml` runs **all ten projects**. Every
matrix leg in that workflow loads the same 1Password preview item, so the
connected secrets and `TEST_CONNECTED_USER_*` are already present — the blocker
was the preview lane's separate, differently-provisioned job.

One thing to stay aware of: `connected-chatbot` reaches the **real** Graph API
with Claire's outbound reply. Quarantining a chatbot spec therefore puts real
Meta traffic on an advisory lane. Nothing does today; check before you tag one.

## How the routing works (required vs advisory)

`.github/workflows/e2e.yml` — one matrix, two kinds of leg:

- **The six required suites** (`smoke`, `bare`, `tabs`, `connected`,
  `connected-ads`, `connected-chatbot`) run `--grep-invert "@quarantine"` — they
  exclude every quarantined spec. A quarantined test therefore **can never block
  a push**.
- **`quarantine` (ADVISORY)** runs `--grep "@quarantine"` across all ten
  projects with `continue-on-error: true` — it runs *only* the quarantined specs
  and **reports** their status (red or green) without gating the merge. With no
  quarantined specs, `playwright test` exits 0, so the lane is a clean green.

Net effect: the required gate only ever fails on a *stable* test, and every
quarantined test still runs every PR so its real green-rate stays visible.

## Reading the gate's green-rate (the flake budget)

- **Required gate** (the six `in-runner (…)` suites): target **near-100% green** on unchanged
  code. A red here means a *stable* test failed — investigate as a real
  regression, do **not** reach for a retry or a `@quarantine` tag to make it
  pass. (CI keeps Playwright's `retries: 2` to absorb genuine infra blips; that
  is not a license to retry a flaky *assertion* into green.)
- **Advisory `quarantine` lane**: track each quarantined spec's green-rate over
  recent runs. The exit condition is concrete:
  - **consistently green** → fix landed / flake gone → **remove the
    `@quarantine` tag** (de-quarantine) in a cleanup PR and close the issue.
  - **still flaky past its deadline** → either land a real fix or **delete the
    spec** — a spec that has lived in quarantine past its deadline is no longer
    earning its keep.

**Flake budget:** keep the quarantine list short and short-lived. A growing
quarantine list, or specs that sit past their deadline, is the signal that the
gate's fidelity is eroding — treat it as backlog to burn down, not steady
state.

## Required vs advisory — GitHub branch ruleset (handoff)

The split above is enforced in the workflow, but **which checks actually block
a merge** is set in the GitHub branch ruleset (web UI only — it cannot be
changed from this repo). Configure the `main` ruleset's *required status
checks* as:

| Job (status-check name) | Ruleset setting | Why |
|---|---|---|
| `in-runner (smoke)` | **Required** | Fast critical-path gate. |
| `in-runner (bare)` | **Required** | The real per-PR functional gate; excludes `@quarantine`. |
| `in-runner (tabs)` | **Required** | Tab-surface regression gate. |
| `in-runner (connected)` | **Required** | Meta + Instagram surfaces. |
| `in-runner (connected-ads)` | **Required** | Runs against the in-process Marketing fake. |
| `in-runner (connected-chatbot)` | **Required** | Inbound pipeline; reaches the real Graph API outbound. |
| `in-runner (quarantine)` | **Advisory** (do **not** add as required) | Known-flaky specs; `continue-on-error: true` already makes it non-blocking, but also leave it off the required list so it never gates. |

> Status-check names come from the matrix leg's `name:` in
> `e2e.yml` — `in-runner (${{ matrix.suite }})`, so the suite key IS
> the check name. Renaming a suite renames its check; update the ruleset's
> required-check list to match or the gate silently stops being enforced.

The example spec `src/quarantine-example.spec.ts` is tagged `@quarantine`
purely to prove this routing; it is a trivial assertion, not a real flaky test.
