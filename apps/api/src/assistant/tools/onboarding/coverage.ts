import { defineCoverage } from '../coverage.types.js';

/**
 * ONBOARDING — 18 endpoints, 0 tools. The Claire-guided signup wizard (the
 * Typeform-style slide deck), and the one area where the coverage decision is
 * made almost entirely by TIMING rather than by risk.
 *
 * Read the controller and the shape is unmistakable: the whole thing is
 * `@SkipPaidPlanCheck`, and the first five routes are additionally
 * a verified address (verification is no longer required anywhere). These
 * endpoints are keyed on `userId`, NOT on an
 * organization, because for most of the flow no organization exists yet —
 * `POST /apply-analysis` is the route that creates one. Everything before it
 * runs while the user is still verifying their email; everything after it runs
 * on an org with no subscription.
 *
 * That is precisely the window in which Claire is NOT reachable. She is the
 * assistant an ONBOARDED OWNER talks to inside the dashboard; a caller who
 * needs `/onboarding/website` has not met her. So "not exposed" here is not a
 * judgement that the capability is dangerous — most of it is harmless — it is
 * that the endpoint's entire lifetime is spent before Claire has a seat.
 *
 * The one exception is the read that OUTLIVES the wizard. A session row
 * persists after completion, and "did the owner actually finish setting up, and
 * what did they skip?" is a question Claire is asked in substance all the time
 * ("why aren't my ads running?"). That one is parked as undecided rather than
 * refused, because a capability plausibly belongs there.
 *
 * Note also the duplication risk in the second half. `suggest-service`,
 * `accept-offer`, `ad-candidates`, `video-candidates` and `launch` are wizard
 * re-implementations of things Claire already does in the dashboard through
 * `claire_recommendServiceForAds`, `offers_suggestIntroOffer`,
 * `content_createContent` and
 * `meta_ads_confirmLaunchAd`. Exposing the onboarding twins would give the
 * model two doors to one room, which is the exact shape of the
 * create-vs-regenerate defect in the audit.
 */
export const onboardingCoverage = defineCoverage('onboarding', {
  // ---- pre-verification session + website analysis ------------------------
  // These run before an organization exists at all. Nothing Claire can call
  // could even resolve an active org here.
  'GET /onboarding/session': {
    undecided: 'ENG-CLAIRE-ONBOARDING',
  },
  'PATCH /onboarding/session': {
    notExposed:
      'Wizard state: advances the slide index and records the answer to the slide currently on screen. Claire is not driving that deck — she is only reachable after it finishes — and writing a slide pointer out from under the frontend would desynchronise the flow the user is looking at.',
  },
  'POST /onboarding/website': {
    notExposed:
      'Slide 0 of the signup wizard: stores the business URL and kicks the website-analysis job that bootstraps the org. It runs before the organization (and therefore before Claire) exists, and it is the step whose answer everything downstream is derived from.',
  },
  'GET /onboarding/analysis/:jobId': {
    notExposed:
      'Polls a scrape/analysis job scoped to `user:{userId}` while the user waits on the analysis slide. It is a progress spinner for a job Claire never started, and the finished snapshot she would actually care about is already applied to the org by apply-analysis.',
  },

  // ---- org bootstrap ------------------------------------------------------
  'POST /onboarding/apply-analysis': {
    notExposed:
      'This is the route that CREATES the organization and its services from the analysis snapshot, then sets it active on the session. It is the boundary Claire lives on the far side of — by the time she can be called it has necessarily already run, and calling it again is meaningless.',
  },

  // ---- campaign flow (wizard twins of live dashboard tools) ---------------
  'POST /onboarding/suggest-service': {
    notExposed:
      'The wizard twin of claire_recommendServiceForAds, reading from the onboarding session rather than the live org. Two tools answering "which service should I advertise?" is how a model picks the wrong one; the dashboard tool is the one that stays correct after onboarding ends.',
  },
  'GET /onboarding/offer-preview': {
    notExposed:
      'Renders the intro offer that accept-offer would create, for one slide to display. offers_suggestIntroOffer already gives Claire an intro-offer recommendation against the live org, so this read adds a second, wizard-shaped answer to a question she can already ask.',
  },
  'POST /onboarding/accept-offer': {
    notExposed:
      'Persists the intro offer AND fire-and-forget kicks both candidate generators (minutes of image and video render). Claire has claire_publishOffer for the deliberate version; triggering a hidden render fan-out as a side effect of an offer write is not behaviour she should own.',
  },
  'POST /onboarding/converse': {
    notExposed:
      'A free-text round-trip with the onboarding Claire persona for a single slide. Wiring it to a tool would have the assistant call itself, one deck-bound conversation nested inside another, with no coherent transcript for either.',
  },
  'POST /onboarding/content-batch': {
    notExposed:
      'Kicks the month-of-content generation for the content_source slide — a heavy fire-and-forget seeding run. It costs real render spend, and the same batch is reachable from the content surface Claire already works in.',
  },

  // ---- candidate generation ----------------------------------------------
  'POST /onboarding/ad-candidates': {
    notExposed:
      'Generates the wizard ad-picker grid, writing candidate ids onto the onboarding session. Claire creates ad creative through content_createContent against the live org; the session-scoped grid is a rendering detail of a deck she is not showing.',
  },
  'POST /onboarding/ad-candidates/:graphicId/regenerate': {
    notExposed:
      'Re-rolls one tile of that wizard grid. graphics_regenerateGraphic is the equivalent Claire owns, and having both is exactly the create-vs-regenerate ambiguity the audit flagged.',
  },
  'GET /onboarding/candidates': {
    notExposed:
      'A render-status poll for the two picker slides: it re-signs private-CDN media so the grids can load, and returns empty once the session has no org. It is a spinner for a screen Claire is not showing, and the picked creative ends up on the org where her own graphics/videos tools already see it.',
  },
  'POST /onboarding/video-candidates': {
    notExposed:
      'Generates the wizard video grid — a minutes-scale, paid render fan-out bound to the onboarding session. Claire builds video deliberately through the videos_* draft/export tools, which she can report progress on.',
  },

  // ---- launch + completion ------------------------------------------------
  'POST /onboarding/stage-campaign': {
    notExposed:
      'Stages the campaign onto the onboarding session — a temporary holding area that only the launch orchestrator below reads. Outside the wizard nothing consumes staged state, so a tool here would write to a scratchpad no one ever picks up.',
  },
  'POST /onboarding/launch': {
    notExposed:
      'Runs the multi-step orchestrator that pushes the staged campaign live and starts spending the owner money on Meta. Launch is a confirmed, single-purpose act in Claire via meta_ads_confirmLaunchAd / executeLaunchAd; a second unconfirmed path to real ad spend is the one duplication that is genuinely expensive to get wrong.',
  },
  'POST /onboarding/complete': {
    notExposed:
      'Marks the session completed, which is what gates the dashboard out of resume-onboarding mode. Only the wizard knows it actually reached the last slide; letting Claire assert completion would strand a user mid-setup with no route back in.',
  },
  'POST /onboarding/reset': {
    notExposed:
      'Rewinds the whole flow to slide one. It is a deliberate destructive-feeling action the user takes from a restart button they can see, and a model reaching for it on a vague "start over" would wipe the progress of a setup session in flight.',
  },
});
