# Window B — Kickoff Brief: Native Tap-to-Pay Maestro flow

> Self-contained handoff for a fresh Claude window to implement the native
> mobile-E2E "1 money flow" (§6.D of `TAB-SUITE.md`). Branch: `feat/fresha-clone`.
> Authoritative spec: **`apps/app-e2e/NATIVE-LANE.md` §5 (Gap 1) + §6**. Read it
> first — this brief is the task wrapper around it.

---

## Why this is its own window

Window A owns the Stripe **stub** tier (browser E2E: card/qr/deposit/subscription
settlement) — it needs a local API rebuild to verify. This window (B) owns the
**native** Tap-to-Pay path, which is device-only and needs an **Android emulator**
to verify. Different capability, zero file overlap → run them in parallel.

**Do NOT touch Window A's files** (`packages/env`, `packages/integrations/src/stripe`,
`apps/api/src/testing`, `apps/app-e2e/src/{sales,calendar,settings}`, the CI
`tabs-suite` env). This window stays entirely in `apps/app/**`.

---

## Goal

Land the single backend/build change + the Maestro flow that gives the native
lane its Tap-to-Pay money flow, per `NATIVE-LANE.md` §6:

1. **Simulated-reader env flag** (§5 Gap 1, sub-blocker 1). Today
   `usesSimulatedReader()` = `import.meta.env.DEV` (`apps/app/src/features/terminal/lib/terminal-service.ts:52`).
   The CI APK is a `vite build` → `DEV` is `false`, so the built app would demand
   **real** Tap-to-Pay hardware (impossible on an emulator). Add an explicit
   `VITE_TAP_TO_PAY_SIMULATE` flag OR'd into `usesSimulatedReader()` so a test
   build forces the simulated reader regardless of `import.meta.env.DEV`. Wire the
   var through the env package the app uses (find how other `VITE_*` flags are
   validated — do NOT read `import.meta.env` raw if the app has an env module).
2. **`.maestro/nightly/08-tap-to-pay.yaml`** (§6 step 2). Drives the debug card's
   simulated Visa charge:
   - sign in (reuse `02-sign-in.yaml`'s pattern — `androidWebViewHierarchy: devtools`,
     `launchApp: { stopApp: false }`, `tapOn` by DOM `id`; see `NATIVE-LANE.md` §2
     "hard-won harness facts").
   - navigate to `/dashboard/debug` → the Tap-to-Pay debug card
     (`apps/app/src/routes/_authed/dashboard/debug/-components/tap-to-pay-debug-card.tsx:119`).
   - trigger the simulated Visa charge, assert the success surface.
   - Keep it **nightly** (`.maestro/nightly/`) until proven it doesn't hit the
     HomeNew OOM render ceiling (§2 emulator note); only then consider a trimmed
     per-PR variant.
3. **`data-testid` on the charge-success surface** in `tap-to-pay-debug-card.tsx`
   so the flow has a stable assertion target (the WebView a11y tree is unreliable —
   §2).

---

## Files in scope (all under apps/app/)

- `apps/app/src/features/terminal/lib/terminal-service.ts` — the `usesSimulatedReader()` flag (`:52`).
- the app's env module (find it — likely `packages/env/src/web.ts`-style or an `apps/app` env file; grep how `VITE_` vars are declared/validated) — add `VITE_TAP_TO_PAY_SIMULATE`.
- `apps/app/src/routes/_authed/dashboard/debug/-components/tap-to-pay-debug-card.tsx` — add the success `data-testid`.
- `apps/app/.maestro/nightly/08-tap-to-pay.yaml` — new flow.
- Possibly `.github/workflows/mobile-e2e.yml` — if the simulate flag must be baked into the CI `build-apk` job's `VITE_*` config (check how the baked config is assembled; the nightly APK needs `VITE_TAP_TO_PAY_SIMULATE=true`).

Full file:line surface inventory: `NATIVE-LANE.md` §3.A.

---

## Verification (needs an emulator — that's why this window exists)

Per `NATIVE-LANE.md` §5 "Emulator / CI requirement":
```bash
# build the debug APK with the simulate flag on
VITE_TAP_TO_PAY_SIMULATE=true apps/app/scripts/build-android.sh --profile development
# boot an emulator (api-34, google_apis, x86_64), then:
bash apps/app/scripts/maestro-android.sh   # handles pm clear → launch → WebView-socket wait → maestro test
```
- Point the baked config at a reachable API (native reads baked `VITE_*`, not a
  runtime tunnel — see memory `reference_capacitor_runtime_config_cors`).
- If no local emulator: land the code + flow, typecheck (`pnpm turbo typecheck --filter=@borradh-workspace/app`) + `turbo build --filter=@borradh-workspace/app`, commit, and let CI's `android-boot` job (on push / `workflow_dispatch` of `mobile-e2e.yml`) run it. State clearly in the final report that runtime was CI-verified, not local.

---

## Guardrails

- **Worktree hygiene.** `feat/fresha-clone` is a shared checkout with ≥2 other
  live windows (Window A + booking-scalability). Work in a dedicated worktree
  (`git worktree add ../borradh-native feat/fresha-clone`), stage ONLY your own
  explicit paths (never `git add -A`), never `-D` another window's branch. (Memory:
  `feedback_shared_checkout_concurrent_sessions`.)
- **Never `--no-verify`** — fix hooks, don't bypass. Pre-commit runs the full
  turbo test suite.
- Commit message lowercase; end with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Don't push (triggers a preview/CI deploy) unless the user asks.

## Out of scope

- Real in-checkout `card_terminal` collection UI (the `payment-panel.tsx:197`
  `terminalClientSecret` seam has no native reader UI in checkout yet — product task).
- `07-photo-upload` un-scaffolding, deep-link (Gap 3), calendar touch-drag (Gap 4)
  — all blocked on Linear ENG-7 (`NATIVE-LANE.md` §5). Leave parked.
- Anything in `packages/integrations/stripe` or the browser E2E suite — that's Window A.

## Definition of done

- [ ] `VITE_TAP_TO_PAY_SIMULATE` flag added + OR'd into `usesSimulatedReader()`, validated through the app's env module.
- [ ] `data-testid` on the debug-card charge-success surface.
- [ ] `08-tap-to-pay.yaml` authored, following the devtools/stopApp:false/id-tap harness rules.
- [ ] CI `build-apk` bakes the simulate flag for the nightly APK (if needed).
- [ ] typecheck + `turbo build --filter=@borradh-workspace/app` green.
- [ ] runtime: green on a local emulator OR explicitly deferred to CI's `android-boot` job, stated in the report.
- [ ] committed on `feat/fresha-clone` (own worktree, explicit paths), not pushed.
