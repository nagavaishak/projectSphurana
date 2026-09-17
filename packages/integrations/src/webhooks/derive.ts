import {
  type Disposition,
  type WebhookEvent,
  type WebhookProvider,
  isHandled,
  isSubscribed,
  providerSubscriptionSource,
} from './define-webhook-event.js';
import {
  instagramEvents,
  metaPageEvents,
  stripeBillingEvents,
  stripeConnectEvents,
  webhookEvents,
  whatsappEvents,
} from './events.js';

/**
 * EVERYTHING below is derived from `events.ts`. Nothing here — and nothing
 * anywhere else in the repo — may hand-type a list of webhook event types or
 * subscription fields. That is what the seven hand-copied `subscribed_fields`
 * arrays WERE.
 */

const byProvider: Record<WebhookProvider, readonly WebhookEvent[]> = {
  meta_page: metaPageEvents,
  instagram: instagramEvents,
  whatsapp: whatsappEvents,
  stripe_connect: stripeConnectEvents,
  stripe_billing: stripeBillingEvents,
};

export const eventsFor = (provider: WebhookProvider): readonly WebhookEvent[] =>
  byProvider[provider];

export const allWebhookEvents: readonly WebhookEvent[] = webhookEvents;

/** The event types of `provider` that must have a handler bound in the router. */
export const handledEventTypes = (provider: WebhookProvider): string[] =>
  eventsFor(provider)
    .filter(isHandled)
    .map((e) => e.type);

/**
 * The `subscribed_fields` list to POST to Meta for this provider.
 *
 * Derived: an event is subscribed if it is handled, OR if it is declared
 * `deliveredAs` — a field that must be named to be delivered at all but whose
 * events classify as another type (see `DeliveredAs`; `message_echoes` is the
 * only instance). `feed` still cannot silently come back: both dispositions
 * carry a written reason and the gate asserts the exact set.
 */
export const subscribedFieldsFor = (
  provider: Extract<WebhookProvider, 'meta_page' | 'instagram'>
): string[] => {
  if (providerSubscriptionSource[provider] !== 'code') {
    throw new Error(
      `${provider} does not subscribe from code — its fields come from the provider dashboard`
    );
  }
  return eventsFor(provider)
    .filter(isSubscribed)
    .map((e) => e.type);
};

/**
 * `deliveredAs` events paired with the type they dispatch as. The gate uses
 * this to assert each one points at a type that is actually handled, so the
 * escape hatch cannot be used to subscribe to a field nothing consumes.
 */
export const deliveredAsPairs = (
  provider: WebhookProvider
): { type: string; as: string }[] =>
  eventsFor(provider)
    .filter((e) => e.disposition.kind === 'deliveredAs')
    .map((e) => ({
      type: e.type,
      as: (e.disposition as { as: string }).as,
    }));

/**
 * The ONE list of Facebook Page webhook fields. Every `/{page}/subscribed_apps`
 * call site in the repo must use this — see `webhook-registry.test.ts`, which
 * fails if a raw field-name literal reappears anywhere else.
 */
export const metaPageSubscribedFields: readonly string[] =
  subscribedFieldsFor('meta_page');

/** The ONE list of Instagram webhook fields. */
export const instagramSubscribedFields: readonly string[] =
  subscribedFieldsFor('instagram');

const lookup = new Map<string, WebhookEvent>(
  webhookEvents.map((e) => [`${e.provider}:${e.type}`, e])
);

export const findWebhookEvent = (
  provider: WebhookProvider,
  type: string
): WebhookEvent | undefined => lookup.get(`${provider}:${type}`);

export type WebhookDisposition =
  | Disposition
  /** The provider sent us something the registry has never heard of. */
  | { readonly kind: 'undeclared' };

/**
 * What the router should do with an inbound event.
 *
 * `undeclared` is deliberately NOT a silent drop: for an externally-subscribed
 * provider (WhatsApp, Stripe) it means the dashboard is sending us a field the
 * code has never been told about, which is exactly the class of drift that made
 * `feed` invisible for a year. The router logs it as an error.
 */
export const dispositionOf = (
  provider: WebhookProvider,
  type: string
): WebhookDisposition =>
  findWebhookEvent(provider, type)?.disposition ?? { kind: 'undeclared' };
