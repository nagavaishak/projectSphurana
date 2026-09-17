/**
 * Tour runner contract for Claire's in-product walkthroughs.
 *
 * Consumed by:
 *   - W12 (tour runner implementation) — driver.js wrapper + Claire chatbox + radiating rings
 *   - W13 (first tour definition)       — `create-ad.tour.ts`
 *
 * Every future tour follows this shape. See:
 *   - docs/plans/claire-owner-spec.md §4.4 (walkthrough model)
 *   - docs/plans/claire-spec-v2.md Decision 6 (in-product tours)
 *   - docs/plans/claire-build-plan.md "Tour Pattern (reference for v2.1+)"
 */

/**
 * What advances a step. Fires automatically when the predicate matches;
 * the runner listens to the DOM event, the router, or an input change.
 */
export type TourAdvanceTrigger =
  | 'click' // target element receives a click
  | 'input-change' // target input element's value becomes non-empty
  | 'option-selected' // target combobox/select has a non-default selection
  | 'navigate' // the router has transitioned to `expectedRoute`
  | 'manual'; // user clicks a "Got it" button in the chatbox

export interface TourStep {
  /**
   * Stable key that matches `data-claire-target="<key>"` on the target
   * DOM element. Selector is `[data-claire-target="<key>"]`.
   */
  target: string;

  /**
   * Optional route to push BEFORE showing this step. Use when the next
   * target lives on a different page (e.g. tour starts on /dashboard and
   * the next step is on /ads/new).
   */
  navigateBefore?: string;

  /** Short heading shown at the top of the Claire chatbox. */
  title?: string;

  /**
   * Body copy shown in the Claire chatbox.
   * May contain `{placeholder}` variables interpolated from the tour's
   * payload (e.g. `"Let's call it {suggestedCampaignName} — feel free to change."`).
   */
  copy: string;

  /** What advances this step. */
  advanceOn: TourAdvanceTrigger;

  /**
   * For `advanceOn: 'navigate'` — the route the runner waits for before
   * advancing (e.g. '/ads/new').
   */
  expectedRoute?: string;

  /**
   * Whether the exit X in the chatbox header cancels the tour on this
   * step. Default: true. Set to false for critical irreversible steps
   * (rare — most tours should be exitable at every step).
   */
  canExit?: boolean;
}

export interface TourDefinition {
  /**
   * Unique identifier — must match a `primary_action.target` on any
   * recommendation that triggers this tour (e.g. `'create_ad'`).
   */
  kind: string;

  /**
   * Ordered sequence of steps. First step starts immediately on tour launch.
   * When the final step advances, the tour completes and the widget re-shows.
   */
  steps: TourStep[];
}

/**
 * Payload passed into the tour from the recommendation's `primary_action.payload`.
 * Field names are referenced in step `copy` as `{fieldName}` placeholders.
 * Typical keys for ad-creation tours: `suggestedCampaignName`, `suggestedService`,
 * `suggestedPrice`, `suggestedPainPoint`, `campaignAngle`.
 */
export type TourPayload = Record<string, unknown>;

/**
 * Handler signature registered in `ClaireWalkthroughProvider`'s handlers map.
 * One per tour kind. The widget dispatcher calls these with the recommendation's
 * payload when the owner clicks Accept on a `type: 'tour'` toast.
 */
export type TourHandler = (payload?: TourPayload) => void;

/**
 * Interpolate `{key}` placeholders in a string using payload values.
 * Missing keys are replaced with the empty string; extra payload keys are ignored.
 *
 * Exported here (and not just in the runner) so W13's tour config can unit-test
 * its copy against fixture payloads without pulling in the runtime runner.
 */
export function interpolateTourCopy(
  template: string,
  payload?: TourPayload
): string {
  if (!payload) return template.replace(/\{\w+\}/g, '');
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = payload[key];
    if (value === undefined || value === null) return '';
    return String(value);
  });
}
