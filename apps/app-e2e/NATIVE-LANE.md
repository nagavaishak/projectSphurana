# Native Mobile-E2E Lane — Framework verdict, surface map, plan

> Companion to `TAB-SUITE.md` §6.D ("Native Maestro lane"). That entry framed the
> native lane as LARGE, not-yet-built infra. **Reconciliation:** the lane already
> exists and its per-PR gate is green — this doc records what's real, which
> native surfaces map to which flows, the gaps, and how to stand up the missing
> money/drag/camera flows. Branch: `feat/fresha-clone`.

---

## 1. Framework verdict — **Maestro** (NOT Detox)

The chosen and wired-up framework for the Capacitor app (`apps/app`) is **Maestro**,
driving a real Android WebView on an emulator. This is settled in code, not
aspirational.

**Why the "Detox" note in memory is a red herring:**
- Memory `project_mobile_e2e_detox` (2026-04-17) decided to migrate `apps/mobile-e2e/`
  (the **old Expo** app) Maestro → Detox.
- Memory `reference_mobile_dual_package` records that `apps/mobile` **and**
  `apps/mobile-e2e` were **deleted** (PR #412, 2026-05-22). The Detox migration
  target no longer exists. `apps/app` (Capacitor) is now the sole mobile app.
- The Detox mentions still lingering in `MIGRATION_DECISIONS.md:177`,
  `MIGRATION_PROGRESS.md:568`, `docs/implementations/claire.md:498`,
  `docs/migration/phase-3-window-briefs.md:46` are all just re-citing that stale
  memory ("out of scope, see `project_mobile_e2e_detox`"), not a live Detox setup.
  A repo-wide grep finds **zero** Detox config (`.detoxrc*`, `e2e/` runner, Detox
  deps). The one `packages/features/.../master-captions.ts:946` hit is the word
  "detox" in ad copy.
- Memory `project_mobile_e2e_strategy` (updated 2026-06-10) is the current truth:
  **Maestro on an Android emulator, per-PR**, iOS gated + nightly. PR #442 landed
  the green boot + sign-in gate.

**Verdict:** build on the existing Maestro lane. Do NOT start a Detox lane. If
Detox is ever revisited it is a fresh decision for `apps/app`, and the memory key
above should be superseded.

Relevant memory keys: `project_mobile_e2e_strategy` (authoritative),
`reference_mobile_dual_package` (Expo app deleted), `project_mobile_e2e_detox`
(stale — target deleted), `feedback_mobile_dev_server`, `e2e_maestro_run_pattern`
(both describe the **old** Expo/mobile-e2e Maestro setup — patterns partly stale),
`reference_capacitor_runtime_config_cors` (native boot / baked VITE_ config).

---

## 2. What already exists (green / scaffolded)

Everything lives under `apps/app/.maestro/` + `.github/workflows/mobile-e2e.yml`
+ `apps/app/scripts/maestro-android.sh` (execution harness).

| Flow file | Surface | Tier | Status |
|-----------|---------|------|--------|
| `.maestro/01-boot.yaml` | WebView boot / white-screen net + interaction probe | **per-PR** | GREEN |
| `.maestro/02-sign-in.yaml` | Better Auth round-trip inside the WebView | **per-PR** | GREEN |
| `.maestro/nightly/03-dashboard.yaml` | HomeNew "Welcome back" render | nightly | green (heavy) |
| `.maestro/nightly/04-external-url.yaml` | `@capacitor/browser` Browser.open (Linear MOBILE-1) | nightly | green |
| `.maestro/nightly/05-profile-update.yaml` | Better Auth updateUser save (MOBILE-9) | nightly | green |
| `.maestro/nightly/06-push-permission.yaml` | Native push register + prefs toggle (WEB-18) | nightly | green |
| `.maestro/nightly/07-photo-upload.yaml` | Native photo-library picker → upload (ENG-30) | nightly | **SCAFFOLD** (blocked, see §5) |

CI shape (`mobile-e2e.yml`): two jobs. `build-apk` (turbo web bundle → `cap sync`
→ gradle `assembleDebug`, per-PR APK cache, points the baked `VITE_*` config at
the PR's Fly preview API) → `android-boot` (downloads the APK, boots emulator,
runs `maestro-android.sh`). Triggers: PR touching `apps/app/**` or `packages/**`,
`workflow_dispatch`, and a nightly `cron` (against prod API, `RUN_NIGHTLY=1`).
iOS job is scaffolded but **commented out** (macOS runners ~10× cost).

Hard-won harness facts already baked in (do not re-discover — from
`project_mobile_e2e_strategy`):
- **`androidWebViewHierarchy: devtools`** is mandatory on every flow. The whole UI
  is one `android.webkit.WebView` whose nodes report
  `important-for-accessibility=false`; without devtools mode Maestro reads the
  a11y tree and every `assertVisible` fails "is false".
- `maestro-android.sh`: `pm clear` → `monkey` launch → poll `/proc/net/unix` for
  the `webview_devtools_remote` socket → `maestro test`. Flows use
  `launchApp: { stopApp: false }` (a restart kills the WebView + CDP socket).
- `tapOn` must target the DOM `id` (e.g. `{ id: 'email' }`), not placeholder text.
- **Emulator render ceiling:** the software-GPU CI emulator OOM-kills the app on
  the heavy post-login HomeNew render even at 8GB (lmkd/RescueParty). Heavy flows
  are therefore parked in `.maestro/nightly/`; the real home for heavy renders is
  a device farm (Firebase Test Lab, real GPU), not the per-PR emulator. Linear
  ENG-7 (testID'd mobile nav + emulator-stable HomeNew) is the unblocker to
  promote nightly flows to per-PR.

---

## 3. Native-gated surface inventory (file:line)

These are the browser-unreachable surfaces from `TAB-SUITE.md` §6.D. In the
browser `app-e2e` suite `Capacitor.isNativePlatform() === false`, so every branch
below is dead code there — only the native WebView boot path exercises them.

### A. Tap to Pay (Stripe Terminal, simulated reader in dev)
- Gate: `apps/app/src/features/terminal/lib/terminal-service.ts:41` — `isTapToPaySupported()` returns false off-native.
- Simulated reader switch: `terminal-service.ts:52` `usesSimulatedReader()` = `import.meta.env.DEV`; `:132`–`:137` sets `SimulatedCardType.Visa`.
- Native plugin lazy import: `terminal-service.ts:66` `import('@capacitor-community/stripe-terminal')` (gated, web-safe).
- UI: `apps/app/src/features/terminal/components/tap-to-pay-button.tsx:69` `TapToPayButton` (renders null on web).
- **Only mount today:** `apps/app/src/routes/_authed/dashboard/debug/-components/tap-to-pay-debug-card.tsx:119`. It is NOT wired into the POS checkout.
- Checkout hand-off to the reader: `apps/app/src/features/sales/components/checkout/payment-panel.tsx:197` (`card_terminal` → `readerType = 'tap_to_pay'`), `:179`–`:180` handles the returned `terminalClientSecret` (reader collection). The client-secret plumbing exists; the native reader-collection UI is only in the debug card.

### B. Calendar touch-drag (react-dnd multi-backend)
- `apps/app/src/components/calendar/components/dnd/dnd-provider.tsx:8` imports `TouchBackend`; `:34` registers it under `TouchTransition` (touch devices), `:29` `HTML5Backend` under `MouseTransition` (desktop). `delayTouchStart: 150` (`:37`) so scroll wins unless long-press. Touch drag is only ever active in a native/touch WebView; HTML5 desktop backend is what browser E2E drives.

### C. Camera / photo picker
- Teleprompter camera: `apps/app/src/features/record/components/teleprompter-recorder.tsx:102` `initCamera()`, `:288` / `:328` `Capacitor.isNativePlatform()` branch, `:333` "Camera access required" fallback.
- Native photo-library picker (content upload): `apps/app/src/routes/_authed/dashboard/marketing/socials/new/-components/content-mobile-media-step.tsx:302` (`<input type="file">` → native picker on device). This is the ENG-30 / `07-photo-upload.yaml` target.
- Onboarding profile photo: `apps/app/src/features/onboarding/setup-profile/tabs/step-photo-title.tsx:71`.

### D. Push permission
- `apps/app/src/lib/push.ts:45` `registerForPushNotifications()`, `:48` native gate, `:63` `PushNotifications.requestPermissions()` (native OS dialog), `:99` `register()`.
- Triggered on sign-in: `apps/app/src/features/auth/use-sign-in.ts:50`; unregistered on sign-out: `apps/app/src/features/auth/use-sign-out.ts:23`; telemetry bootstrap: `apps/app/src/components/telemetry-bootstrap.tsx:36`.

### E. Deep links
- `apps/app/src/lib/deep-links.ts:28` native gate, `:31` `App.addListener('appUrlOpen', …)`, `:36` `App.getLaunchUrl()` (cold-start launch URL).

---

## 4. Per-PR gate vs nightly (target shape)

- **Per-PR gate (Android emulator, Linux, free):** stay tiny + emulator-stable —
  `01-boot` + `02-sign-in`. Per `TAB-SUITE.md` §6.D the intent is **boot + sign-in
  + 1 money flow**; the money flow is **not yet present** (see §5 gap 1). It can
  join the per-PR gate ONLY if it avoids the HomeNew heavy render (e.g. drive Tap
  to Pay via the debug card / a light POS entry, not through the dashboard paint).
- **Nightly (Android, `RUN_NIGHTLY=1` on `schedule`):** heavy or native-gap flows
  that transit HomeNew — dashboard, external-url, profile-update, push, photo,
  and (future) calendar touch-drag. iOS nightly job is scaffolded/commented in
  `mobile-e2e.yml`; enable on macOS runner once Android nightly is stable.
- **Device farm (manual / handoff):** real APNs/FCM delivery, real Tap-to-Pay
  hardware entitlement, camera capture quality — never per-PR emulator.

Surface → flow map:

| Native surface (§3) | Existing flow | Tier | Gap |
|---------------------|---------------|------|-----|
| Push permission (D) | `nightly/06-push-permission.yaml` | nightly | none (green) |
| Camera / photo picker (C) | `nightly/07-photo-upload.yaml` | nightly | blocked (§5 gap 2) |
| Deep links (E) | partial: `nightly/04-external-url.yaml` (Browser.open) | nightly | no true `appUrlOpen` inbound-link flow (§5 gap 3) |
| Tap to Pay (A) | **none** | — | **missing** (§5 gap 1) |
| Calendar touch-drag (B) | **none** | — | **missing** (§5 gap 4) |

---

## 5. Gaps + concrete next steps

**Gap 1 — no Tap to Pay Maestro flow (the "1 money flow" §6.D calls for).**
Two sub-blockers before a flow can exist:
1. `usesSimulatedReader()` = `import.meta.env.DEV` (`terminal-service.ts:52`). The
   CI APK is a `vite build` (`build-android.sh --profile development`) → `DEV` is
   almost certainly `false`, so the built app would try **real** Tap-to-Pay
   hardware (impossible on an emulator). Add an explicit
   `VITE_TAP_TO_PAY_SIMULATE`-style env flag OR'd into `usesSimulatedReader()` so
   a test build forces the simulated reader regardless of `import.meta.env.DEV`.
2. `TapToPayButton` is only mounted in the debug card
   (`tap-to-pay-debug-card.tsx:119`), not in the POS checkout. Fastest green path:
   a Maestro flow that signs in → deep-links / navigates to `/dashboard/debug` →
   taps the Tap-to-Pay card → drives the simulated Visa charge to a success phase.
   (A real in-checkout `card_terminal` collection is a product task — `payment-panel`
   has the `terminalClientSecret` seam but no native reader UI in checkout yet.)
   Verify whether this can avoid the HomeNew render; if not, it's nightly.
   Give it a stable `data-testid` on the charge-success surface for assertion.

**Gap 2 — `07-photo-upload.yaml` is a scaffold, blocked on two deps** (documented
in the flow header): (a) ENG-7 — no in-app navigation currently reaches
`/dashboard/marketing/socials/new` (the media step), so no deterministic tap-path
to the picker; needs a testID'd "create content" entry. (b) Seeded gallery — the
CI emulator boots with an empty photo library; the runner must `adb push` a
fixture into `/sdcard/Pictures` + media-scan before the flow (the `RUN_NIGHTLY`
step in `mobile-e2e.yml:365`-`:366` already does this — keep it in sync with the
media path). Un-scaffold once ENG-7 lands.

**Gap 3 — no true inbound deep-link flow.** `04-external-url` tests
`Browser.open` (outbound), not `App.addListener('appUrlOpen')` /
`App.getLaunchUrl()` (`deep-links.ts:31`,`:36`). Add a nightly flow that fires
`adb shell am start -a android.intent.action.VIEW -d "borradh://…"` and asserts
the SPA routed. Low priority.

**Gap 4 — no calendar touch-drag flow.** `dnd-provider.tsx` TouchBackend is only
active in a touch WebView, so browser E2E can never cover drag-to-reschedule.
A Maestro `swipe`/long-press-drag flow on the calendar grid would cover it, but it
transits the heavy calendar render → **nightly / device-farm** tier, and needs
stable testIDs on appointment cards + target slots. Depends on ENG-7-class
emulator stability. Defer until a real drag bug motivates it.

**Emulator / CI requirement (and why this can't run here):** the lane needs an
Android emulator with KVM (or a macOS sim for iOS). CI provides it via
`reactivecircus/android-emulator-runner` (api-34, google_apis, x86_64, pixel_6,
4 cores / 8GB, cached AVD snapshot). **This headless session has no emulator**, so
none of these flows can be executed or verified here — the work above is
scaffold + plan only. To exercise locally: build the debug APK
(`apps/app/scripts/build-android.sh --profile development`), boot an emulator, then
`bash apps/app/scripts/maestro-android.sh` (see the harness for the WebView-socket
wait). Point the baked config at a reachable API per
`reference_capacitor_runtime_config_cors` (native reads baked `VITE_*`, not
`api.daniel.borradh-dev.com` at runtime).

---

## 6. Immediate recommendation

1. Land the **Tap-to-Pay simulated-reader env flag** (gap 1, sub-blocker 1) — it's
   the single backend/build change that unblocks the "1 money flow" §6.D wants.
2. Add `.maestro/nightly/08-tap-to-pay.yaml` driving the debug card's simulated
   Visa charge; keep it nightly until proven it doesn't hit the HomeNew ceiling,
   then consider promoting a trimmed version to the per-PR gate.
3. Leave `07-photo-upload` and a future `09-deep-link` / calendar-drag flow parked
   until ENG-7 (testID'd mobile nav + emulator-stable renders) lands.

No new config files were scaffolded here — the Maestro lane already exists and the
missing pieces (env flag, new flow files) are best added in a change that can be
run against a real emulator, not blind in this session.
