import { ReviewContentStep } from './review-content-step';

export function StepReviewTalkingHead() {
  return (
    <ReviewContentStep
      contentType="talking_head"
      title="Review Talking Head"
      description="These assets were classified as founder or talking head footage. You can re-categorize or remove any that don't belong."
      emptyMessage="No Talking Head assets detected in this batch."
    />
  );
}
