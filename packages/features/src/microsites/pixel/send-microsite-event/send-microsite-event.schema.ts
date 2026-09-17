import { z } from 'zod';

/** Mirrors `MetaCapiEventName` — kept as a zod enum so DTOs can derive from it. */
export const micrositeEventNameSchema = z.enum([
  'PageView',
  'ViewContent',
  'Lead',
  'Contact',
  'Schedule',
  'InitiateCheckout',
  'Purchase',
  'CompleteRegistration',
]);

const trackingConsentSchema = z.object({
  ads: z.boolean(),
  analytics: z.boolean().optional(),
  source: z
    .enum(['banner', 'booking_form', 'imported', 'unknown'])
    .default('unknown'),
  at: z.string().default(() => new Date().toISOString()),
  region: z.string().length(2).optional(),
  limitedDataUse: z.boolean().optional(),
});

/** Raw customer identifiers. HASHED before they leave this process. */
const userDataSchema = z.object({
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  firstName: z.string().optional().nullable(),
  lastName: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  dateOfBirth: z.string().optional().nullable(),
  gender: z.string().optional().nullable(),
  // Sent raw, per Meta's spec.
  clientIpAddress: z.string().optional().nullable(),
  clientUserAgent: z.string().optional().nullable(),
  fbc: z.string().optional().nullable(),
  fbp: z.string().optional().nullable(),
});

export const sendMicrositeEventSchema = z.object({
  organizationId: z.string().min(1),
  /** Scope for the event id. Stable across a custom-domain move. */
  micrositeId: z.string().min(1),
  eventName: micrositeEventNameSchema,
  /**
   * The thing that happened ONCE — appointment id, lead id, view id. Combined
   * with eventName + micrositeId into the `event_id` the browser must match.
   */
  dedupeKey: z.string().min(1),
  /** Unix SECONDS. Defaults to now. */
  eventTime: z.number().int().positive().optional(),
  eventSourceUrl: z.string().url().optional(),
  actionSource: z
    .enum([
      'website',
      'phone_call',
      'chat',
      'email',
      'system_generated',
      'other',
    ])
    .optional(),
  /** Lead the event belongs to. Its stored consent is used when none is passed. */
  leadId: z.string().min(1).optional().nullable(),
  user: userDataSchema.optional(),
  customData: z.record(z.string(), z.unknown()).optional(),
  /**
   * TRUE only when this event describes a booking/transaction the person
   * actually completed. It is a factual claim, and it is what lets a
   * conversion flow without consent — never set it to force an event through.
   */
  hasTransactionBasis: z.boolean().optional(),
  /** Overrides the lead's stored consent (e.g. a first-touch anonymous view). */
  consent: trackingConsentSchema.optional(),
  /** Visitor country (ISO-3166-1 alpha-2), for the US/CCPA LDU decision. */
  region: z.string().length(2).optional().nullable(),
  metaAdsPageId: z.string().min(1).optional().nullable(),
});

export type SendMicrositeEventInput = z.infer<typeof sendMicrositeEventSchema>;
