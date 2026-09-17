/**
 * Whether a Gemini 429 is a billing-cap rejection rather than transient quota
 * pressure. The provider uses HTTP 429 for both, but only the latter can be
 * recovered by retrying a job.
 *
 * Google has changed this wording over time, so recognize the documented
 * billing concepts rather than relying on one complete error sentence.
 */
export function isGeminiBillingLimitError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('prepayment credits are depleted') ||
    normalized.includes('manage your project and billing') ||
    normalized.includes(
      'billing account has exceeded its monthly spending cap'
    ) ||
    normalized.includes('ai.studio/billing') ||
    normalized.includes('tier-spend-caps')
  );
}
