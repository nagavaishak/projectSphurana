import { z } from 'zod';

export const handleMembershipSubscriptionWebhookSchema = z.object({
  eventType: z.enum([
    'customer.subscription.updated',
    'customer.subscription.deleted',
  ]),
  stripeSubscriptionId: z.string().min(1),
  /** Raw Stripe subscription status (active, past_due, canceled, ...). */
  stripeStatus: z.string().min(1),
  /** Stripe current_period_end, when present on the event. */
  currentPeriodEnd: z.date().nullish(),
});

export type HandleMembershipSubscriptionWebhookInput = z.infer<
  typeof handleMembershipSubscriptionWebhookSchema
>;
