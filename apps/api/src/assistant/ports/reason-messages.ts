import type {
  BudgetBlockedReason,
  CreateBlockedReason,
  RenderBlockedReason,
} from '@borradh-workspace/contracts/ports';

/**
 * Human sentences for the port's blocked reasons.
 *
 * Kept in one place so every tool phrases the same refusal the same way, and
 * so the `switch` statements below are exhaustive: add a `kind` to a reason
 * union and TypeScript flags the missing case here rather than letting a tool
 * fall through to a vague "something went wrong".
 */

export function describeRenderBlocked(reason: RenderBlockedReason): string {
  switch (reason.kind) {
    case 'video_not_found':
      return "That video no longer exists — it may have been deleted. Create a new draft and I'll render that instead.";
    case 'not_a_draft':
      return reason.currentStatus === 'unknown'
        ? 'That video is not in a state that can be rendered right now.'
        : `That video is already ${reason.currentStatus}, so there's nothing to queue.`;
    case 'incomplete_config':
      return `The draft isn't ready to render yet: ${reason.detail}`;
    case 'b_roll_transcode_failed':
      return 'Some of the clips could not be prepared. Replace or re-upload them, then try the render again.';
    case 'b_roll_still_processing':
      return 'Some clips are still processing. Give it a moment and try the render again.';
    case 'other':
      return reason.message;
    case 'server_error':
      return 'Something went wrong on our side while queueing the render. Try again in a moment.';
  }
}

export function describeCreateBlocked(reason: CreateBlockedReason): string {
  switch (reason.kind) {
    case 'missing_before_after_media':
      return `A before & after video needs media tagged ${reason.missing
        .map((m) => `"${m}"`)
        .join(
          ' and '
        )}. Upload tagged photos or video first, then ask me again.`;
    case 'offer_not_found':
      return `I couldn't find that offer (${reason.offerId}). List the offers and pick one that's still live.`;
    case 'service_not_found':
      return `I couldn't find that service (${reason.serviceId}). List the services and pick one.`;
    case 'other':
      return reason.message;
    case 'server_error':
      return 'Something went wrong on our side while creating the video. Try again in a moment.';
  }
}

export function describeBudgetBlocked(reason: BudgetBlockedReason): string {
  switch (reason.kind) {
    case 'learning_phase':
      // The message the hard-block validator wrote is the one the owner needs;
      // it explains the learning window in their terms.
      return reason.message;
    case 'campaign_not_found':
      return `I couldn't find campaign ${reason.metaCampaignId} — it may have been deleted on Meta's side.`;
    case 'not_confirmed':
      return `I can't apply that budget change: ${reason.detail}`;
    case 'other':
      return reason.message;
    case 'server_error':
      return 'Something went wrong on our side while updating the budget. The budget has NOT changed — try again in a moment.';
  }
}
