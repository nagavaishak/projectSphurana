/**
 * Contact properties synced to Loops.
 * Keys must be camelCase and match custom properties created in Loops dashboard.
 */
export interface LoopsContactProperties {
  firstName?: string;
  lastName?: string;
  businessName?: string;
  businessType?: string;
  /** Onboarding task flags */
  taskCreatePost?: boolean;
  taskBooking?: boolean;
  taskBookingPage?: boolean;
  taskLeadFollowUp?: boolean;
  taskAds?: boolean;
}

/** Events we fire to Loops to trigger automations */
export type LoopsEventName =
  | 'signup'
  | 'onboarding_completed'
  | 'task_completed';

export interface SendEventOptions {
  email?: string;
  userId?: string;
  eventName: LoopsEventName;
  contactProperties?: LoopsContactProperties;
  eventProperties?: Record<string, string | number | boolean>;
}

export interface UpdateContactOptions {
  email: string;
  properties: LoopsContactProperties;
  userId?: string;
}
