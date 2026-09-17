import {
  defineWebhookEvent,
  deliveredAs,
  handled,
  ignoredBecause,
} from './define-webhook-event.js';
import {
  metaFeedChangeSchema,
  metaLeadgenChangeSchema,
  metaMessagingEventSchema,
  stripeEventSchema,
  whatsappChangeSchema,
} from './payloads.js';

/**
 * THE registry. Every webhook event this system can receive is declared here
 * exactly once, with either a handler (bound in the router) or a written reason
 * for dropping it.
 *
 * For `meta_page` and `instagram` the `subscribed_fields` we POST to Meta is
 * DERIVED from the `handled()` entries below — so an event cannot be subscribed
 * without a handler, which is the bug this registry exists to make impossible.
 */

// ---------------------------------------------------------- Facebook Page

export const metaPageEvents = [
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'leadgen',
    delivery: 'changes',
    payload: metaLeadgenChangeSchema,
    disposition: handled(),
    note: 'Lead-form submissions. Primary acquisition channel.',
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'messages',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: handled(),
    note: 'Inbound Messenger messages. Page echoes CLASSIFY as this type (they carry `message`), but are only DELIVERED if `message_echoes` is also subscribed — see that declaration.',
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'message_echoes',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: deliveredAs(
      'messages',
      "An echo arrives in `entry[].messaging[]` carrying `message.is_echo`, and `classifyMetaMessagingEvent` attributes anything with a `message` key to `messages` — so this field can never BE the classified type, yet Meta will not deliver echoes at all unless it is named in subscribed_fields. Instagram needs no equivalent: its topic has no `message_echoes` field and echoes ride on `messages`, which is exactly the asymmetry that hid this. Without it, a clinic replying from Meta's own inbox never triggers agent takeover and the bot talks over them (ENG-813)."
    ),
    note: "Page-side outbound echoes: human replies from the Page inbox / Business Suite, and the page's own auto-responders. Drives agent takeover via recordEchoMessage.",
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'messaging_referrals',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: handled(),
    note: 'Standalone click-to-Messenger ad referral (thread entered, no message yet).',
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'messaging_postbacks',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Postbacks are produced only by button/persistent-menu/get-started templates, and we send none — Claire uses quick replies, which Meta delivers INSIDE a `messages` event as `message.quick_reply`. Subscribing would deliver events that no surface can produce. Re-subscribe in the same commit that adds a button template.'
    ),
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'messaging_optins',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Requires the Checkbox / Send-to-Messenger plugin, which we do not embed anywhere. No opt-in event can be produced.'
    ),
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'message_deliveries',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Per-message delivery receipts. Nothing in the product surfaces delivery state; the controller `continue`d on every one. This subscription cost roughly one webhook per outbound message for zero effect.'
    ),
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'message_reads',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Read receipts. Same as deliveries — no UI consumes them and the controller dropped them.'
    ),
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'message_edit',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Declared for the same reason as Instagram: we keep the message as first received. Only observed on Instagram so far, but `classifyMetaMessagingEvent` keys on the payload shape rather than the platform, so a Page-side edit would classify as this type — and an undeclared type is logged as an error.'
    ),
  }),
  defineWebhookEvent({
    provider: 'meta_page',
    type: 'feed',
    delivery: 'changes',
    payload: metaFeedChangeSchema,
    disposition: ignoredBecause(
      'Comments/reactions on Page posts, including posts behind ads. THERE IS NO COMMENT-INGESTION FEATURE: this field was subscribed by three separate code paths and handled by none — Meta delivered the comment and we 200-dropped it with a log line reading "acknowledging". Ingesting ad comments as leads is a real product feature and needs its own design (comment → lead? auto-reply? private-reply within the 7-day window?). Until that exists, the honest state is UNSUBSCRIBED rather than subscribed-and-silently-dropped. Re-enable in the same commit that adds the handler.'
    ),
  }),
] as const;

// ------------------------------------------------------------------ Instagram

export const instagramEvents = [
  defineWebhookEvent({
    provider: 'instagram',
    type: 'messages',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: handled(),
    note: 'Inbound Instagram DMs. Delivered to the same /webhooks/meta/messaging endpoint with object="instagram".',
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'messaging_referral',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: handled(),
    note: 'IG spells this SINGULAR where the Page API spells it plural. Same handler.',
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'messaging_postbacks',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Same as the Page: we send no button templates, so no postback can be produced.'
    ),
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'messaging_optins',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'No opt-in surface exists on Instagram either.'
    ),
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'messaging_seen',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Read receipts. No UI consumes them (see message_reads).'
    ),
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'message_reactions',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Emoji reactions on DMs. We store no reaction state on a message.'
    ),
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'messaging_handover',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Handover Protocol thread-control events. We do not participate in handover — human takeover is modelled inside Borradh (conversation.assignee), not via Meta thread control.'
    ),
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'standby',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'Only meaningful with the Handover Protocol, which we do not use. Standby events arrive when another app is the primary receiver — never our case.'
    ),
  }),
  defineWebhookEvent({
    provider: 'instagram',
    type: 'message_edit',
    delivery: 'messaging',
    payload: metaMessagingEventSchema,
    disposition: ignoredBecause(
      'A user edited a DM they had already sent. We persist the message as first received and have no edit-history surface, so there is nothing to reconcile. Arrives unbidden — an ignored event is never in subscribed_fields.'
    ),
  }),
] as const;

// ------------------------------------------------------------------- WhatsApp
// Subscription is EXTERNAL: the WABA is subscribed via /{waba}/subscribed_apps
// with no field list — Meta sends whatever the app dashboard has enabled. We
// cannot unsubscribe from code, so every field must carry a disposition and the
// router logs an ERROR (not a silent 200) for anything undeclared.

export const whatsappEvents = [
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'messages',
    payload: whatsappChangeSchema,
    disposition: handled(),
    note: 'Inbound WA messages AND outbound status callbacks (sent/delivered/read/failed).',
  }),
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'smb_message_echoes',
    payload: whatsappChangeSchema,
    disposition: handled(),
    note: 'Coexistence: messages the owner sent from the WhatsApp Business app itself.',
  }),
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'history',
    payload: whatsappChangeSchema,
    disposition: handled(),
    note: 'Coexistence history sync (phase 1/2 backfill of existing threads).',
  }),
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'smb_app_state_sync',
    payload: whatsappChangeSchema,
    disposition: ignoredBecause(
      'Coexistence contact/label state from the WhatsApp Business app. We do not mirror WA labels or its address book — leads are the system of record.'
    ),
  }),
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'message_template_status_update',
    payload: whatsappChangeSchema,
    disposition: handled(),
    note: 'Template approval/rejection push. Reconciles whatsapp_template.status so the campaign composer + launch pre-flight reflect approval without a manual refresh.',
  }),
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'account_update',
    payload: whatsappChangeSchema,
    disposition: ignoredBecause(
      'WABA-level account/ban/verification changes. No surface consumes them; a ban shows up as a send failure we already log.'
    ),
  }),
  defineWebhookEvent({
    provider: 'whatsapp',
    type: 'phone_number_quality_update',
    payload: whatsappChangeSchema,
    disposition: ignoredBecause(
      'Messaging-quality tier changes for the WA number. Informational; we surface no quality dial.'
    ),
  }),
] as const;

// ------------------------------------------------------------- Stripe Connect
// Subscription is EXTERNAL (Stripe dashboard event selection).

export const stripeConnectEvents = [
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'checkout.session.completed',
    payload: stripeEventSchema,
    disposition: handled(),
    note: 'Sale tender (Payment Link), general payment, or appointment deposit — routed by metadata.type.',
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'checkout.session.expired',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'charge.refunded',
    payload: stripeEventSchema,
    disposition: handled(),
    note: 'Resolved by payment_intent against sale tenders first, then falls through to payment/deposit routing.',
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'payment_intent.succeeded',
    payload: stripeEventSchema,
    disposition: handled(),
    note: 'Terminal / Tap to Pay settles here — no checkout.session exists for it.',
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'payment_intent.payment_failed',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'account.updated',
    payload: stripeEventSchema,
    disposition: handled(),
    note: 'Connected-account onboarding/capability status.',
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'customer.subscription.updated',
    payload: stripeEventSchema,
    disposition: handled(),
    note: 'Recurring memberships.',
  }),
  defineWebhookEvent({
    provider: 'stripe_connect',
    type: 'customer.subscription.deleted',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
] as const;

// ------------------------------------------------------------- Stripe billing
// Platform-account (our own SaaS billing). Subscription is EXTERNAL.

export const stripeBillingEvents = [
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'checkout.session.completed',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'customer.subscription.created',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'customer.subscription.updated',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'customer.subscription.deleted',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'invoice.created',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'invoice.paid',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'invoice.payment_failed',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
  defineWebhookEvent({
    provider: 'stripe_billing',
    type: 'charge.refunded',
    payload: stripeEventSchema,
    disposition: handled(),
  }),
] as const;

export const webhookEvents = [
  ...metaPageEvents,
  ...instagramEvents,
  ...whatsappEvents,
  ...stripeConnectEvents,
  ...stripeBillingEvents,
] as const;

export type MetaPageEventType = (typeof metaPageEvents)[number]['type'];
export type InstagramEventType = (typeof instagramEvents)[number]['type'];
export type WhatsappEventType = (typeof whatsappEvents)[number]['type'];
export type StripeConnectEventType =
  (typeof stripeConnectEvents)[number]['type'];
export type StripeBillingEventType =
  (typeof stripeBillingEvents)[number]['type'];
