import type { z } from 'zod';

/**
 * The webhook-event registry.
 *
 * ONE declaration per (provider, event type). Everything else — the
 * `subscribed_fields` list we send to Meta, the handler map the router must
 * satisfy, the idempotency ledger's provider key — is DERIVED from it.
 *
 * Why this exists: `subscribed_fields` used to be spelled four different ways
 * across six call sites, so whether a Page received `feed` or `message_reads`
 * depended on which button the user clicked months ago. `feed` was subscribed
 * by three of those call sites and handled by NONE — a customer commented on
 * your ad, Meta delivered it, and we 200'd it with a log line that said
 * "acknowledging". Two ops scripts existed purely to hand-reconcile the drift.
 *
 * The rule this file enforces:
 *
 *   For a provider we subscribe to FROM CODE, an event is subscribed IF AND
 *   ONLY IF it is handled. "Subscribed with no handler" is not expressible.
 *
 *   For a provider that pushes to us regardless (WhatsApp fields configured in
 *   the Meta app dashboard; Stripe events configured in the Stripe dashboard),
 *   every event type MUST be declared either `handled()` or
 *   `ignoredBecause('…')`. A silent 200-and-drop is not acceptable; an
 *   undeclared event is logged as an error, not swallowed.
 */

/** Every webhook source we accept traffic from. */
export const webhookProviders = [
  'meta_page',
  'instagram',
  'whatsapp',
  'stripe_connect',
  'stripe_billing',
] as const;

export type WebhookProvider = (typeof webhookProviders)[number];

/**
 * How a provider's event subscription is established.
 *
 * - `code`: we POST the field list ourselves (Meta `/{id}/subscribed_apps`), so
 *   the list is DERIVED from this registry and "subscribed" is our choice.
 * - `external`: the provider decides what to send us based on dashboard config
 *   (WhatsApp webhook fields, Stripe event selection). We cannot unsubscribe
 *   from code, so every type must still carry a disposition.
 */
export const providerSubscriptionSource: Record<
  WebhookProvider,
  'code' | 'external'
> = {
  meta_page: 'code',
  instagram: 'code',
  whatsapp: 'external',
  stripe_connect: 'external',
  stripe_billing: 'external',
};

/**
 * Where a Meta event arrives in the envelope. `changes` events land in
 * `entry[].changes[].field`; `messaging` events land in `entry[].messaging[]`
 * and are discriminated by which key the event object carries.
 */
export type MetaDelivery = 'changes' | 'messaging';

export type Handled = { readonly kind: 'handled' };
export type Ignored = { readonly kind: 'ignored'; readonly because: string };
/**
 * Subscribed, but its events arrive on the wire already classified as ANOTHER
 * declared type, so this one binds no handler of its own.
 *
 * The registry's headline rule is "subscribed IFF handled". `message_echoes`
 * is the one shape that rule cannot express, and the cost of not expressing it
 * was total: Messenger page echoes were never subscribed, so a clinic owner
 * replying in Meta's own inbox was invisible to us and the bot talked over
 * them — for every org, since launch (ENG-813).
 *
 * The mechanism is a Meta quirk. An echo is delivered in `entry[].messaging[]`
 * carrying `message.is_echo`, and `classifyMetaMessagingEvent` attributes
 * anything with a `message` key to `messages`. So the field must be named in
 * `subscribed_fields` to be delivered at all, yet can never be the classified
 * type. Declaring it `handled()` would demand a handler the router can never
 * reach; omitting it entirely is what actually happened.
 */
export type DeliveredAs = {
  readonly kind: 'deliveredAs';
  /** The declared type these events classify as. Must itself be handled. */
  readonly as: string;
  readonly because: string;
};
export type Disposition = Handled | Ignored | DeliveredAs;

/** This event has a handler bound in the router. */
export const handled = (): Handled => ({ kind: 'handled' });

/**
 * Subscribe to this field, but bind no handler: its events are classified and
 * dispatched as `as`. The reason is mandatory and read in review, exactly like
 * `ignoredBecause` — this is a subscription with no handler of its own, which
 * is the shape the registry exists to make impossible by accident. It stays
 * expressible only WITH a written justification.
 */
export const deliveredAs = (as: string, because: string): DeliveredAs => {
  if (!as.trim()) {
    throw new Error('deliveredAs requires the type these events dispatch as');
  }
  if (!because.trim()) {
    throw new Error('deliveredAs requires a written reason');
  }
  return { kind: 'deliveredAs', as, because };
};

/**
 * This event has NO handler, deliberately. The reason is mandatory and is read
 * in review — this is the `exempt(why)` pattern. For a `code`-subscribed
 * provider it also means we do not subscribe to it at all, so it is never
 * delivered; for an `external` provider it means we drop it on purpose and say
 * why in the log.
 */
export const ignoredBecause = (because: string): Ignored => {
  if (!because.trim()) {
    throw new Error('ignoredBecause requires a written reason');
  }
  return { kind: 'ignored', because };
};

export interface WebhookEvent<
  P extends WebhookProvider = WebhookProvider,
  T extends string = string,
  D extends Disposition = Disposition,
> {
  readonly provider: P;
  /**
   * The provider's own identifier for the event, exactly as it appears on the
   * wire. For Meta this IS the `subscribed_fields` token (`messages`, `feed`,
   * `leadgen`, …) — which is precisely why the subscription list can be derived
   * from the registry instead of hand-copied.
   */
  readonly type: T;
  /** Loose zod shape of the event body handed to the handler. */
  readonly payload: z.ZodTypeAny;
  readonly disposition: D;
  /** Meta only: which part of the envelope carries this event. */
  readonly delivery?: MetaDelivery;
  /** Free-text note kept next to the declaration (not a disposition). */
  readonly note?: string;
}

export const defineWebhookEvent = <
  P extends WebhookProvider,
  T extends string,
  D extends Disposition,
>(event: {
  provider: P;
  type: T;
  payload: z.ZodTypeAny;
  delivery?: MetaDelivery;
  note?: string;
  disposition: D;
}): WebhookEvent<P, T, D> => event;

/**
 * The event types of a provider that a router MUST bind a handler for.
 * Used to build an exhaustive `Record<HandledTypeOf<…>, Handler>` — so a
 * handled-but-unbound event is a COMPILE error, and a bound-but-ignored event
 * is an excess-property error.
 */
export type HandledTypeOf<E extends WebhookEvent> = Extract<
  E,
  { disposition: Handled }
>['type'];

/** Narrowing helper used by the derivations and the gate. */
export const isHandled = (e: WebhookEvent): boolean =>
  e.disposition.kind === 'handled';

/**
 * Does this event belong in the provider's `subscribed_fields`?
 *
 * Handled events, plus the `deliveredAs` fields that must be named to be
 * delivered at all. Deliberately NOT the same predicate as `isHandled`: the
 * handler map is bound from `isHandled`, so a `deliveredAs` field is
 * subscribed without being required to have a handler it could never reach.
 */
export const isSubscribed = (e: WebhookEvent): boolean =>
  e.disposition.kind === 'handled' || e.disposition.kind === 'deliveredAs';
