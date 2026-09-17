import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — "cross-context imports go through the public barrel".
 *
 * `packages/features/src/<domain>/` holds ~69 bounded contexts (appointments,
 * scheduling, chatbots, claire, billing, …). A file in domain A may reach into
 * a SIBLING domain B ONLY through B's PUBLIC surface — the package subpath
 * export `@borradh-workspace/features/<B>`, which resolves to `<B>/index.ts`.
 *
 * Reaching deep into a sibling's internals via a relative path, e.g. in
 * `chatbots/services/direct-booking/book-direct-appointment.ts`:
 *   import { createAppointment }   from '../../../appointments/services/create-appointment/index.js';
 *   import { resolveAvailability } from '../../../scheduling/services/resolve-availability/index.js';
 * binds A to B's implementation layout. That is exactly what makes the eventual
 * package split painful: B cannot move a file, rename a service, or change its
 * internal barrels without breaking A. The public barrel is the contract; the
 * insides are not.
 *
 * HOW IT WORKS
 * ------------
 * We statically scan `packages/features/src`, resolve every RELATIVE import to a
 * path, and figure out which domain (if any) it lands in. An import is a
 * violation when it lands INSIDE a DIFFERENT sibling domain (i.e. deeper than
 * that domain's top-level `index.ts`). These are ALL allowed:
 *   - same-domain relative imports (`./…`, `../…` within domain A)
 *   - imports of `../shared/…`                     (the shared kernel)
 *   - a sibling's PUBLIC barrel `../<B>/index.js`   (the public surface itself)
 *   - `@borradh-workspace/features/<B>` package imports (already the barrel)
 *   - anything that doesn't resolve into a real sibling domain
 *
 * THE RATCHET
 * -----------
 * `KNOWN_VIOLATIONS` is the burn-down list. It may only ever SHRINK:
 *   - Adding a NEW deep cross-context import → test FAILS (import from the
 *     sibling's public barrel `@borradh-workspace/features/<B>` instead of
 *     baselining it).
 *   - Fixing a deep import but forgetting to delete its baseline entry → test
 *     FAILS (stale baseline), forcing the list to shrink so the fix can't
 *     silently regress later.
 *
 * DO NOT add entries to `KNOWN_VIOLATIONS` to make a new violation pass. The
 * whole point is that the number only goes down.
 *
 * EXCLUSIONS
 * ----------
 * Seeds, test/spec files, mocks, and the integration test harness legitimately
 * reach across boundaries to set up fixtures — they are NOT product code, so
 * they are excluded from the rule entirely (see EXCLUDED_PATH_SEGMENTS below).
 * The `shared/` kernel and the `architecture/` tests are not domains.
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../');
const FEATURES_SRC = path.join(REPO_ROOT, 'packages/features/src');

/**
 * Path fragments that opt a file OUT of the rule. These are not product code:
 *   - test / spec files
 *   - `**​/seeds/**` and `seed-*.ts`             (DB seeding)
 *   - `**​/_integration/**`                       (Testcontainers harness + int-specs)
 *   - `**​/__mocks__/**`                          (vitest boundary mocks)
 */
const EXCLUDED_PATH_SEGMENTS = [
  '.test.ts',
  '.spec.ts',
  '/seeds/',
  '/_integration/',
  '/__mocks__/',
];
const EXCLUDED_BASENAME_PREFIXES = ['seed-'];

/**
 * Directories directly under `packages/features/src` that are NOT bounded
 * contexts: the shared kernel (importing it is always allowed), the mocks dir,
 * and this architecture test dir.
 */
const NON_DOMAIN_DIRS = new Set(['shared', '__mocks__', 'architecture']);

/** The real domain list, derived from the directory names under features/src. */
const DOMAINS: ReadonlySet<string> = new Set(
  readdirSync(FEATURES_SRC).filter((entry) => {
    if (NON_DOMAIN_DIRS.has(entry)) return false;
    return statSync(path.join(FEATURES_SRC, entry)).isDirectory();
  })
);

/**
 * RATCHET BASELINE — deep cross-context imports that exist TODAY, keyed as
 * `<fromDomain>-><toDomain>::<repo-relative-path>` (one entry per file+target,
 * regardless of how many deep specifiers the file has into that target).
 * This is the burn-down worklist. It may only shrink. See header for the rules.
 */
const KNOWN_VIOLATIONS: ReadonlySet<string> = new Set([
  'ai-content->assistant::packages/features/src/ai-content/services/generate-offer-copy/generate-offer-copy.service.ts',
  'api-keys->auth::packages/features/src/api-keys/services/list-api-keys/list-api-keys.service.ts',
  'api-keys->auth::packages/features/src/api-keys/services/update-api-key/update-api-key.service.ts',
  'appointments->booking-forms::packages/features/src/appointments/services/reschedule-managed-appointment/reschedule-managed-appointment.service.ts',
  'appointments->calendar::packages/features/src/appointments/services/delete-appointment/delete-appointment.service.ts',
  'appointments->notifications::packages/features/src/appointments/services/create-appointment/create-appointment.service.ts',
  'appointments->notifications::packages/features/src/appointments/services/notify-deposit-paid/notify-deposit-paid.service.ts',
  'appointments->notifications::packages/features/src/appointments/services/update-appointment/update-appointment.service.ts',
  'appointments->scheduling::packages/features/src/appointments/services/create-appointment/create-appointment.service.ts',
  'assistant->meta-campaigns::packages/features/src/assistant/proactive-nudges/run-nudges.ts',
  'assistant->meta-campaigns::packages/features/src/assistant/triggers/four-day-no-leads/four-day-no-leads.trigger.ts',
  'assistant->organizations::packages/features/src/assistant/services/delete-memory/delete-memory.service.ts',
  'assistant->organizations::packages/features/src/assistant/services/edit-memory/edit-memory.service.ts',
  'assistant->videos::packages/features/src/assistant/services/build-draft-clips-system-text/build-draft-clips-system-text.service.ts',
  'booking-forms->appointments::packages/features/src/booking-forms/services/submit-general-booking/submit-general-booking.service.ts',
  'booking-forms->notifications::packages/features/src/booking-forms/services/submit-general-booking/submit-general-booking.service.ts',
  'booking-forms->scheduling::packages/features/src/booking-forms/services/shared/compute-available-slots.ts',
  'calendar->scheduling::packages/features/src/calendar/services/check-availability/check-availability.service.ts',
  'campaigns->billing::packages/features/src/campaigns/services/_shared/estimate-cost.ts',
  'campaigns->billing::packages/features/src/campaigns/services/send-campaign-message/send-campaign-message.service.ts',
  'chatbots->appointments::packages/features/src/chatbots/services/direct-booking/book-direct-appointment.ts',
  'chatbots->appointments::packages/features/src/chatbots/services/generate-ai-response/generate-ai-response.service.ts',
  'chatbots->assistant::packages/features/src/chatbots/services/generate-ai-response/generate-ai-response.service.ts',
  'chatbots->calendar::packages/features/src/chatbots/services/direct-booking/offer-booking-slots.ts',
  'chatbots->calendar::packages/features/src/chatbots/services/evaluate-reschedule-policy/evaluate-reschedule-policy.service.ts',
  'chatbots->calendar::packages/features/src/chatbots/services/generate-ai-response/generate-ai-response.service.ts',
  'chatbots->conversations::packages/features/src/chatbots/services/generate-ai-response/generate-ai-response.service.ts',
  'chatbots->conversations::packages/features/src/chatbots/services/generate-ai-response/resolve-lead-enquiry.ts',
  'chatbots->conversations::packages/features/src/chatbots/services/process-chatbot-flow-job/process-chatbot-flow-job.service.ts',
  'chatbots->integrations::packages/features/src/chatbots/services/execute-flow/deliver-messages.ts',
  'chatbots->scheduling::packages/features/src/chatbots/services/direct-booking/book-direct-appointment.ts',
  'chatbots->voice-cloning::packages/features/src/chatbots/services/generate-ai-response/build-test-chat-context.ts',
  'claire->assistant::packages/features/src/claire/verticals/aesthetic-clinic/render-copy.ts',
  'claire->meta-ads::packages/features/src/claire/draft-state/draft-ad.schema.ts',
  'claire->meta-ads::packages/features/src/claire/draft-state/promote-draft-ad.service.ts',
  'content-batches->graphics::packages/features/src/content-batches/services/accept-batch-item/accept-batch-item.service.ts',
  'content-batches->graphics::packages/features/src/content-batches/services/generate-monthly-batch/generate-monthly-batch.service.ts',
  'content-batches->graphics::packages/features/src/content-batches/services/regenerate-batch-item/regenerate-batch-item.service.ts',
  'content-batches->monthly-content-plan::packages/features/src/content-batches/services/generate-monthly-batch/generate-monthly-batch.service.ts',
  'content-batches->social-posts::packages/features/src/content-batches/services/accept-batch-item/accept-batch-item.service.ts',
  'content-batches->social-posts::packages/features/src/content-batches/services/generate-monthly-batch/generate-monthly-batch.service.ts',
  'content-batches->videos::packages/features/src/content-batches/services/accept-batch-item/accept-batch-item.service.ts',
  'content-batches->videos::packages/features/src/content-batches/services/build-batch-plan/build-batch-plan.service.ts',
  'content-batches->videos::packages/features/src/content-batches/services/regenerate-batch-item/regenerate-batch-item.service.ts',
  'conversations->chatbots::packages/features/src/conversations/services/escalate-conversation/escalate-conversation.service.ts',
  'conversations->chatbots::packages/features/src/conversations/services/handle-incoming-message/handle-incoming-message.service.ts',
  'conversations->chatbots::packages/features/src/conversations/services/handle-incoming-message/update-existing-conversation.ts',
  'conversations->chatbots::packages/features/src/conversations/services/record-echo-message/record-echo-message.service.ts',
  'conversations->integrations::packages/features/src/conversations/services/sync-conversation-messages/sync-conversation-messages.service.ts',
  'conversations->meta-ads::packages/features/src/conversations/services/handle-incoming-message/handle-incoming-message.service.ts',
  'conversations->meta-ads::packages/features/src/conversations/services/handle-incoming-message/handle-standalone-referral.ts',
  'conversations->meta-ads::packages/features/src/conversations/services/send-message/send-message.service.ts',
  'conversations->notifications::packages/features/src/conversations/services/escalate-conversation/escalate-conversation.service.ts',
  'conversations->notifications::packages/features/src/conversations/services/escalate-conversation/notify-agents.ts',
  'conversations->website-analysis::packages/features/src/conversations/tools/website-fetch.tool.ts',
  'graphics->image-generation::packages/features/src/graphics/services/generate-graphic-from-service/generate-graphic-from-service.service.ts',
  'graphics->image-generation::packages/features/src/graphics/services/list-graphic-templates/list-graphic-templates.service.ts',
  'image-generation->social-posts::packages/features/src/image-generation/services/build-brand-corpus/build-brand-corpus.service.ts',
  'integrations->assets::packages/features/src/integrations/services/import-drive-file/import-drive-file.service.ts',
  'integrations->calendar::packages/features/src/integrations/services/connect-google-calendar/connect-google-calendar.service.ts',
  'integrations->calendar::packages/features/src/integrations/services/disconnect-calendar-account/disconnect-calendar-account.service.ts',
  'integrations->voice-cloning::packages/features/src/integrations/services/configure-meta-integration/configure-meta-integration.service.ts',
  'integrations->voice-cloning::packages/features/src/integrations/services/connect-meta-ads/connect-meta-ads.service.ts',
  'meta-ads->integrations::packages/features/src/meta-ads/services/_shared/handle-meta-error.ts',
  'meta-ads->integrations::packages/features/src/meta-ads/services/_shared/validate-ad-prerequisites.ts',
  'meta-ads->integrations::packages/features/src/meta-ads/services/finalize-ad/finalize-ad.service.ts',
  'meta-ads->integrations::packages/features/src/meta-ads/services/run-health-alerts/run-health-alerts.service.ts',
  'meta-ads->meta-campaigns::packages/features/src/meta-ads/services/_shared/get-meta-credentials.ts',
  'meta-ads->meta-campaigns::packages/features/src/meta-ads/services/ensure-campaign-config/ensure-campaign-config.service.ts',
  'meta-ads->meta-campaigns::packages/features/src/meta-ads/services/import-meta-ads/import-meta-ads.service.ts',
  'meta-ads->notifications::packages/features/src/meta-ads/services/run-health-alerts/run-health-alerts.service.ts',
  'meta-ads->notifications::packages/features/src/meta-ads/services/sync-from-meta/sync-from-meta.service.ts',
  'meta-campaigns->experiments::packages/features/src/meta-campaigns/services/create-campaign/create-campaign.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/_shared/index.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/create-campaign/create-campaign.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/delete-campaign/delete-campaign.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/duplicate-campaign/duplicate-campaign.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/get-campaign-insights/get-campaign-insights.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/list-campaigns-insights/list-campaigns-insights.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/list-campaigns/list-campaigns.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/pause-campaign/pause-campaign.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/resume-campaign/resume-campaign.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/sync-campaign-insights/sync-campaign-insights.service.ts',
  'meta-campaigns->meta-ads::packages/features/src/meta-campaigns/services/update-campaign/update-campaign.service.ts',
  'meta-sync->meta-ads::packages/features/src/meta-sync/services/sync-meta-data/sync-meta-data.service.ts',
  'monthly-content-plan->image-generation::packages/features/src/monthly-content-plan/services/plan-monthly-content/plan-monthly-content.service.ts',
  'monthly-content-plan->videos::packages/features/src/monthly-content-plan/services/dispatch-monthly-plan/dispatch-monthly-plan.service.ts',
  'onboarding->claire::packages/features/src/onboarding/services/accept-intro-offer/accept-intro-offer.service.ts',
  'onboarding->claire::packages/features/src/onboarding/services/preview-intro-offer/preview-intro-offer.service.ts',
  'onboarding->claire::packages/features/src/onboarding/services/suggest-campaign-service/suggest-campaign-service.service.ts',
  'onboarding->lead-forms::packages/features/src/onboarding/services/launch-staged-campaign/launch-staged-campaign.service.ts',
  'onboarding->lead-forms::packages/features/src/onboarding/services/stage-onboarding-campaign/stage-onboarding-campaign.service.ts',
  'onboarding->meta-ads::packages/features/src/onboarding/services/launch-staged-campaign/launch-staged-campaign.service.ts',
  'onboarding->meta-ads::packages/features/src/onboarding/services/stage-onboarding-campaign/stage-onboarding-campaign.service.ts',
  'onboarding->meta-campaigns::packages/features/src/onboarding/services/launch-staged-campaign/launch-staged-campaign.service.ts',
  'onboarding->org-defaults::packages/features/src/onboarding/services/stage-onboarding-campaign/stage-onboarding-campaign.service.ts',
  'onboarding->organizations::packages/features/src/onboarding/services/apply-analysis-to-organization/apply-analysis-to-organization.service.ts',
  'onboarding->organizations::packages/features/src/onboarding/services/reset-onboarding-session/reset-onboarding-session.service.ts',
  'onboarding->organizations::packages/features/src/onboarding/services/stage-onboarding-campaign/stage-onboarding-campaign.service.ts',
  'onboarding->website-analysis::packages/features/src/onboarding/services/start-onboarding-website-analysis/start-onboarding-website-analysis.service.ts',
  'organizations->practitioners::packages/features/src/organizations/services/accept-invitation/accept-invitation.service.ts',
  'organizations->scheduling::packages/features/src/organizations/services/create-organization/create-organization.service.ts',
  'organizations->sequences::packages/features/src/organizations/services/create-organization/create-organization.service.ts',
  'practitioners->organizations::packages/features/src/practitioners/services/create-team-member/create-team-member.service.ts',
  'practitioners->scheduling::packages/features/src/practitioners/services/create-practitioner/create-practitioner.service.ts',
  'practitioners->scheduling::packages/features/src/practitioners/services/create-team-member/create-team-member.service.ts',
  'sales->gift-cards::packages/features/src/sales/services/complete-sale/complete-sale.service.ts',
  'sequences->billing::packages/features/src/sequences/services/sequence-executor/execute-email-step.ts',
  'sequences->billing::packages/features/src/sequences/services/sequence-executor/execute-sms-step.ts',
  'sequences->billing::packages/features/src/sequences/services/sequence-executor/execute-voice-step.ts',
  'sequences->billing::packages/features/src/sequences/services/sequence-executor/execute-whatsapp-step.ts',
  'sequences->phone-numbers::packages/features/src/sequences/services/sequence-executor/execute-voice-step.ts',
  'sequences->phone-numbers::packages/features/src/sequences/services/test-call/test-call.service.ts',
  'social-posts->graphics::packages/features/src/social-posts/services/publish-social-post/publish-social-post.service.ts',
  'social-posts->integrations::packages/features/src/social-posts/services/create-social-post/create-social-post.service.ts',
  'social-posts->integrations::packages/features/src/social-posts/services/fetch-page-media/fetch-page-media.service.ts',
  'social-posts->integrations::packages/features/src/social-posts/services/publish-social-post/publish-social-post.service.ts',
  'social-posts->videos::packages/features/src/social-posts/services/generate-post-caption/generate-post-caption.schema.ts',
  'users->practitioners::packages/features/src/users/services/update-user/update-user.service.ts',
  'videos->ai-content::packages/features/src/videos/services/build-offer-card/offer-card-block.ts',
  'videos->assets::packages/features/src/videos/services/plan-video-detail/plan-video-detail.service.ts',
  'videos->social-posts::packages/features/src/videos/services/plan-video-detail/plan-video-detail.service.ts',
  'voice->calendar::packages/features/src/voice/services/handle-voice-tool-call/handle-voice-tool-call.service.ts',
  'voice-cloning->assistant::packages/features/src/voice-cloning/services/embed-voice-examples/embed-voice-examples.service.ts',
  'voice-cloning->assistant::packages/features/src/voice-cloning/services/retrieve-voice-examples/retrieve-voice-examples.service.ts',
]);

/**
 * Matches `import ... from '<spec>'`, `export ... from '<spec>'`, and dynamic
 * `import('<spec>')`. We only care about the specifier; relative ones are then
 * resolved against the importing file.
 */
const IMPORT_RE =
  /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function isExcluded(absPath: string): boolean {
  const normalized = absPath.replaceAll(path.sep, '/');
  if (EXCLUDED_PATH_SEGMENTS.some((seg) => normalized.includes(seg))) {
    return true;
  }
  const base = path.basename(normalized);
  return EXCLUDED_BASENAME_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function collectTsFiles(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !isExcluded(full)) {
      acc.push(full);
    }
  }
}

/** The domain a path under features/src belongs to, or null if outside src. */
function domainOf(absPath: string): string | null {
  const rel = path.relative(FEATURES_SRC, absPath).replaceAll(path.sep, '/');
  if (rel.startsWith('..') || rel === '') return null;
  return rel.split('/')[0];
}

/**
 * True when a resolved import path lands ON a domain's public barrel
 * (`<domain>/index.ts`, `<domain>/index.js`, or the bare `<domain>/` dir) rather
 * than inside its internals.
 */
function landsOnPublicBarrel(resolved: string, domain: string): boolean {
  const remainder = path
    .relative(path.join(FEATURES_SRC, domain), resolved)
    .replaceAll(path.sep, '/');
  return (
    remainder === '' ||
    remainder === 'index' ||
    remainder === 'index.js' ||
    remainder === 'index.ts'
  );
}

/**
 * Every deep cross-context import, keyed as
 * `<fromDomain>-><toDomain>::<repo-relative-path>` (deduped per file+target).
 */
function findViolations(): Set<string> {
  const files: string[] = [];
  collectTsFiles(FEATURES_SRC, files);

  const violations = new Set<string>();
  for (const file of files) {
    const fromDomain = domainOf(file);
    // Files in shared/, architecture/, __mocks__, or outside src are not a
    // bounded context and are not subject to the rule.
    if (fromDomain === null || NON_DOMAIN_DIRS.has(fromDomain)) continue;

    const content = readFileSync(file, 'utf8');
    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null = IMPORT_RE.exec(content);
    while (match !== null) {
      const spec = match[1] ?? match[2];
      match = IMPORT_RE.exec(content);
      // Only relative imports can reach into a sibling's internals. Package
      // imports (`@borradh-workspace/features/<B>`) already go via the barrel.
      if (!spec || !spec.startsWith('.')) continue;

      const resolved = path.resolve(path.dirname(file), spec);
      const toDomain = domainOf(resolved);
      if (toDomain === null) continue; // resolves outside features/src
      if (toDomain === fromDomain) continue; // same-domain relative import → OK
      if (NON_DOMAIN_DIRS.has(toDomain)) continue; // shared kernel → OK
      if (!DOMAINS.has(toDomain)) continue; // not a real sibling domain
      if (landsOnPublicBarrel(resolved, toDomain)) continue; // public surface → OK

      const relPath = path.relative(REPO_ROOT, file).replaceAll(path.sep, '/');
      violations.add(`${fromDomain}->${toDomain}::${relPath}`);
    }
  }
  return violations;
}

describe('architecture: cross-context imports go through the public barrel', () => {
  const violations = findViolations();

  it('has no deep cross-context imports (except the baseline)', () => {
    const newViolations = [...violations]
      .filter((v) => !KNOWN_VIOLATIONS.has(v))
      .sort();

    expect(
      newViolations,
      `New deep cross-context import(s) found reaching into a sibling domain's\ninternals. Import from the sibling's PUBLIC barrel instead:\n  import { thing } from '@borradh-workspace/features/<domain>';\nIf the symbol isn't exported there, export it from that domain's top-level\nindex.ts — do NOT reach into '../<domain>/services/...'.\nOffenders:\n  ${newViolations.join('\n  ')}`
    ).toEqual([]);
  });

  it('has no stale baseline entries (the ratchet may only shrink)', () => {
    const stale = [...KNOWN_VIOLATIONS]
      .filter((v) => !violations.has(v))
      .sort();

    expect(
      stale,
      `These baseline entries are no longer deep cross-context imports — the\nboundary refactor is done. Delete them from KNOWN_VIOLATIONS so they can\nnever regress:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });
});
