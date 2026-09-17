/**
 * Fixtures for the retention, messaging, reminder, review, notification and
 * sequence wireframes (`docs/handoffs/booking-surfaces.md` §11–§16).
 *
 * Real names, real treatments, real GBP amounts and the spec's VERBATIM message
 * copy. The copy matters more than the layout on these pages: §11.1, §12.2,
 * §12.3 and §16.1 all specify exact patient-facing wording, and the thing a
 * reviewer has to judge is whether a 240-character WhatsApp body still reads
 * well inside a preview bubble at 380px. Lorem ipsum answers none of that.
 *
 * One clinic runs through every page (Harley Aesthetics, owner Dr. Aoife
 * Byrne) so retention → messages → reviews reads as one business rather than
 * six unrelated demos.
 */

export const CLINIC = {
  name: 'Harley Aesthetics',
  owner: 'Aoife',
  timezone: 'Europe/London',
} as const;

/* ============================================================ §13 retention */

export interface WfRetentionMetric {
  label: string;
  value: string;
  delta: string;
  tone: 'neutral' | 'good' | 'bad';
  sub?: string;
}

/** §13 — the eight top-level metrics, each with a trend against the previous period. */
export const RETENTION_METRICS: WfRetentionMetric[] = [
  {
    label: 'Active clients',
    value: '412',
    delta: '↑ 18 vs last period',
    tone: 'good',
    sub: 'Visited in the last 90 days',
  },
  {
    label: 'New this month',
    value: '37',
    delta: '↓ 4 vs last month',
    tone: 'bad',
    sub: 'First-ever visit',
  },
  {
    label: 'Returning this month',
    value: '148',
    delta: '↑ 11 vs last month',
    tone: 'good',
    sub: '2nd visit or later',
  },
  {
    label: 'Lapsed',
    value: '63',
    delta: '↑ 9 vs last period',
    tone: 'bad',
    sub: 'No visit in 30–90 days',
  },
  {
    label: 'Lost',
    value: '104',
    delta: '↓ 6 vs last period',
    tone: 'good',
    sub: 'No visit in 90+ days',
  },
  {
    label: 'Retention rate',
    value: '71%',
    delta: '↑ 3 pts vs last quarter',
    tone: 'good',
    sub: 'Clients from 3 months ago who returned',
  },
  {
    label: 'Avg visits per client',
    value: '3.4',
    delta: '↑ 0.2 vs last year',
    tone: 'good',
    sub: 'Last 12 months',
  },
  {
    label: 'Avg revenue per client',
    value: '£684',
    delta: '↑ £41 vs last year',
    tone: 'good',
    sub: 'Last 12 months',
  },
];

export type WfPromptStatus =
  | 'not_sent'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'clicked'
  | 'booked'
  | 'ignored';

export const PROMPT_STATUS_LABEL: Record<WfPromptStatus, string> = {
  not_sent: 'Not sent',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  clicked: 'Clicked',
  booked: 'Booked',
  ignored: 'No response',
};

export interface WfDueRow {
  id: string;
  name: string;
  lastTreatment: string;
  lastVisit: string;
  daysOverdue: number;
  status: WfPromptStatus;
}

/** §13 — "Clients due for rebooking": the interval set in §12.1 has passed. */
export const DUE_ROWS: WfDueRow[] = [
  {
    id: 'due-1',
    name: 'Amy Keogh',
    lastTreatment: 'Botox — glabella',
    lastVisit: '2 Jun 2026',
    daysOverdue: 27,
    status: 'ignored',
  },
  {
    id: 'due-2',
    name: 'Priya Raman',
    lastTreatment: 'Dermal filler — lips',
    lastVisit: '9 Mar 2026',
    daysOverdue: 21,
    status: 'read',
  },
  {
    id: 'due-3',
    name: 'Chloe Donnelly',
    lastTreatment: 'Hydrafacial',
    lastVisit: '31 Jul 2026',
    daysOverdue: 15,
    status: 'delivered',
  },
  {
    id: 'due-4',
    name: 'Hannah Okafor',
    lastTreatment: 'Laser hair removal — full legs',
    lastVisit: '18 Jul 2026',
    daysOverdue: 9,
    status: 'not_sent',
  },
  {
    id: 'due-5',
    name: 'Megan Fitzgerald',
    lastTreatment: 'Chemical peel — medium depth',
    lastVisit: '5 Aug 2026',
    daysOverdue: 5,
    status: 'not_sent',
  },
  {
    id: 'due-6',
    name: 'Sofia Marchetti',
    lastTreatment: 'Botox — full upper face',
    lastVisit: '28 May 2026',
    daysOverdue: 3,
    status: 'clicked',
  },
];

export interface WfLapsedRow {
  id: string;
  name: string;
  lastVisit: string;
  daysSince: number;
  lifetimeSpend: string;
  lastTreatment: string;
}

export const LAPSED_ROWS: WfLapsedRow[] = [
  {
    id: 'lap-1',
    name: 'Rachel Byrne',
    lastVisit: '14 Jul 2026',
    daysSince: 49,
    lifetimeSpend: '£1,240',
    lastTreatment: 'Dermal filler — cheeks',
  },
  {
    id: 'lap-2',
    name: 'Emma Considine',
    lastVisit: '2 Jul 2026',
    daysSince: 61,
    lifetimeSpend: '£860',
    lastTreatment: 'Hydrafacial',
  },
  {
    id: 'lap-3',
    name: 'Laura Nwosu',
    lastVisit: '20 Jun 2026',
    daysSince: 73,
    lifetimeSpend: '£3,415',
    lastTreatment: 'Botox — glabella and crow’s feet',
  },
  {
    id: 'lap-4',
    name: 'Niamh Cullen',
    lastVisit: '11 Jun 2026',
    daysSince: 82,
    lifetimeSpend: '£455',
    lastTreatment: 'Chemical peel — superficial',
  },
];

export const LOST_ROWS: WfLapsedRow[] = [
  {
    id: 'lost-1',
    name: 'Grace Ademola',
    lastVisit: '3 Feb 2026',
    daysSince: 210,
    lifetimeSpend: '£2,980',
    lastTreatment: 'Body contouring — course of 8',
  },
  {
    id: 'lost-2',
    name: 'Sarah Whelan',
    lastVisit: '14 Mar 2026',
    daysSince: 171,
    lifetimeSpend: '£5,120',
    lastTreatment: 'Anti-wrinkle — upper face',
  },
  {
    id: 'lost-3',
    name: 'Katie O’Donovan',
    lastVisit: '29 Apr 2026',
    daysSince: 125,
    lifetimeSpend: '£690',
    lastTreatment: 'Laser hair removal — underarm',
  },
];

export interface WfTreatmentPerf {
  id: string;
  treatment: string;
  patients: number;
  rebookingRate: number;
  revenuePerPatient: string;
  visitsPerPatient: string;
}

/** §13 — sorted by rebooking rate: the owner's answer to "what drives repeat business". */
export const TREATMENT_PERF: WfTreatmentPerf[] = [
  {
    id: 'perf-1',
    treatment: 'Hydrafacial',
    patients: 96,
    rebookingRate: 78,
    revenuePerPatient: '£412',
    visitsPerPatient: '4.8',
  },
  {
    id: 'perf-2',
    treatment: 'Botox — upper face',
    patients: 184,
    rebookingRate: 71,
    revenuePerPatient: '£742',
    visitsPerPatient: '3.6',
  },
  {
    id: 'perf-3',
    treatment: 'Laser hair removal',
    patients: 74,
    rebookingRate: 64,
    revenuePerPatient: '£605',
    visitsPerPatient: '5.2',
  },
  {
    id: 'perf-4',
    treatment: 'Chemical peel',
    patients: 58,
    rebookingRate: 52,
    revenuePerPatient: '£268',
    visitsPerPatient: '2.9',
  },
  {
    id: 'perf-5',
    treatment: 'Dermal filler — lips',
    patients: 112,
    rebookingRate: 44,
    revenuePerPatient: '£880',
    visitsPerPatient: '2.1',
  },
  {
    id: 'perf-6',
    treatment: 'Body contouring',
    patients: 27,
    rebookingRate: 31,
    revenuePerPatient: '£1,340',
    visitsPerPatient: '6.4',
  },
];

/**
 * §13 — the recent rebooking feed. `reached` is how far along the five-stage
 * chain each prompt got, rendered as a micro-timeline rather than one badge:
 * "delivered but never read" and "read and ignored" are different problems and
 * a single status pill collapses them.
 */
export const ACTIVITY_STAGES = [
  'Sent',
  'Delivered',
  'Read',
  'Clicked',
  'Booked',
] as const;

export interface WfActivityRow {
  id: string;
  name: string;
  treatment: string;
  when: string;
  reached: number;
  outcome: string;
}

export const RECENT_ACTIVITY: WfActivityRow[] = [
  {
    id: 'act-1',
    name: 'Sofia Marchetti',
    treatment: 'Botox — full upper face',
    when: 'Today, 09:12',
    reached: 4,
    outcome: 'Clicked the booking link, no appointment yet',
  },
  {
    id: 'act-2',
    name: 'Isabelle Moreau',
    treatment: 'Hydrafacial',
    when: 'Yesterday, 16:40',
    reached: 5,
    outcome: 'Booked 12 Sep, 14:00 with Dr. Aoife Byrne',
  },
  {
    id: 'act-3',
    name: 'Priya Raman',
    treatment: 'Dermal filler — lips',
    when: '2 days ago',
    reached: 3,
    outcome: 'Read, no response — win-back sequence starts on day 30',
  },
  {
    id: 'act-4',
    name: 'Amy Keogh',
    treatment: 'Botox — glabella',
    when: '4 days ago',
    reached: 2,
    outcome: 'Delivered, never opened',
  },
  {
    id: 'act-5',
    name: 'Daniel Osei',
    treatment: 'Chemical peel — medium depth',
    when: '6 days ago',
    reached: 1,
    outcome: 'WhatsApp failed, SMS fallback sent',
  },
];

/* ============================================================ §11.5 log */

export type WfChannel = 'whatsapp' | 'sms' | 'email';
export type WfMessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export const CHANNEL_LABEL: Record<WfChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  email: 'Email',
};

export const MESSAGE_STATUS_LABEL: Record<WfMessageStatus, string> = {
  queued: 'Queued',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
};

export interface WfMessageRow {
  id: string;
  sentAt: string;
  patient: string;
  type: string;
  channel: WfChannel;
  status: WfMessageStatus;
  /**
   * §11.5 — the failure REASON or the patient's reply, in one column.
   * They occupy the same slot deliberately: both answer "and then what
   * happened", and a log that shows a red "Failed" with no reason is the
   * support ticket it was built to prevent.
   */
  detail?: string;
}

export const MESSAGE_LOG: WfMessageRow[] = [
  {
    id: 'msg-1',
    sentAt: 'Today, 10:04',
    patient: 'Amy Keogh',
    type: '24-hour reminder',
    channel: 'whatsapp',
    status: 'read',
    detail: 'Replied “CONFIRM” at 10:11 — appointment confirmed',
  },
  {
    id: 'msg-2',
    sentAt: 'Today, 09:58',
    patient: 'Hannah Okafor',
    type: '24-hour reminder',
    channel: 'whatsapp',
    status: 'delivered',
  },
  {
    id: 'msg-3',
    sentAt: 'Today, 09:41',
    patient: 'Daniel Osei',
    type: 'Rebooking prompt',
    channel: 'sms',
    status: 'failed',
    detail:
      'Outside the 24-hour WhatsApp window — SMS fallback also failed (unreachable number)',
  },
  {
    id: 'msg-4',
    sentAt: 'Today, 08:30',
    patient: 'Priya Raman',
    type: 'Post-care instructions',
    channel: 'whatsapp',
    status: 'read',
  },
  {
    id: 'msg-5',
    sentAt: 'Today, 08:02',
    patient: 'Megan Fitzgerald',
    type: '2-hour reminder',
    channel: 'whatsapp',
    status: 'read',
    detail: 'Replied “CANCEL” at 08:09 — cancellation requested, slot held',
  },
  {
    id: 'msg-6',
    sentAt: 'Today, 07:15',
    patient: 'Chloe Donnelly',
    type: 'Review request',
    channel: 'whatsapp',
    status: 'read',
    detail: 'Replied “5” — routed to the Google review link',
  },
  {
    id: 'msg-7',
    sentAt: 'Yesterday, 18:22',
    patient: 'Rachel Byrne',
    type: 'Win-back — day 60',
    channel: 'email',
    status: 'sent',
  },
  {
    id: 'msg-8',
    sentAt: 'Yesterday, 17:50',
    patient: 'Laura Nwosu',
    type: 'No-show rebooking offer',
    channel: 'whatsapp',
    status: 'failed',
    detail: 'Template “no_show_rebook_v2” is pending Meta approval',
  },
  {
    id: 'msg-9',
    sentAt: 'Yesterday, 16:40',
    patient: 'Isabelle Moreau',
    type: 'Rebooking prompt',
    channel: 'whatsapp',
    status: 'read',
    detail: 'Booked 12 Sep, 14:00',
  },
  {
    id: 'msg-10',
    sentAt: 'Yesterday, 14:05',
    patient: 'Niamh Cullen',
    type: 'Pre-care instructions',
    channel: 'sms',
    status: 'delivered',
  },
  {
    id: 'msg-11',
    sentAt: 'Yesterday, 11:30',
    patient: 'Sofia Marchetti',
    type: 'Review request',
    channel: 'whatsapp',
    status: 'read',
    detail: 'Replied “2” — negative feedback, task created for Aoife',
  },
  {
    id: 'msg-12',
    sentAt: 'In 4 minutes',
    patient: 'Emma Considine',
    type: '24-hour reminder',
    channel: 'whatsapp',
    status: 'queued',
  },
];

/* ======================================================== §11/§12 settings */

/** §11.1 — verbatim. Merge fields left in braces so the editor can chip them. */
export const REMINDER_24H =
  'Hi {patient_first_name}, just a reminder that you have a {treatment_name} appointment tomorrow at {time} with {practitioner_name} at {clinic_name}. Reply CONFIRM to confirm or CANCEL if you need to reschedule.';

export const REMINDER_2H =
  'Hi {patient_first_name}, your {treatment_name} appointment is in 2 hours at {time}. We look forward to seeing you!';

/** §11.2 — what the patient gets after replying CANCEL. */
export const CANCEL_REPLY =
  'No problem. Would you like to rebook? Here are the next available times: {slot_1}, {slot_2}, {slot_3}.';

/** §11.3 — the no-show recovery opener. */
export const NO_SHOW_MESSAGE = `Hi {patient_first_name}, we noticed you weren't able to make it today. Would you like to rebook? {slot_1}, {slot_2}, {slot_3}`;

/** §11.4 — configured per service; these are the injectables defaults. */
export const PRE_CARE =
  'Please arrive with clean skin, no makeup. Avoid blood thinners and alcohol 24 hours before.';
export const POST_CARE =
  'Avoid lying down for 4 hours. No vigorous exercise for 24 hours. Avoid touching the treated area.';

/** §12.2 — the interval prompt. */
export const REBOOK_MESSAGE = `Hi {patient_first_name}, it's been {weeks_since} since your last {treatment_name} at {clinic_name}. To keep your results looking their best, we'd recommend booking your next session soon. Would you like to book? {booking_link}`;

/** §12.3 — the 30-day catch-all, which collides with §14's win-back. */
export const LAPSED_MESSAGE = `Hi {patient_first_name}, we haven't seen you at {clinic_name} in a while and we'd love to have you back. If there's anything we can help with, just reply to this message or book your next appointment here: {booking_link}`;

export const MERGE_FIELDS = [
  '{patient_first_name}',
  '{clinic_name}',
  '{treatment_name}',
  '{practitioner_name}',
  '{booking_link}',
  '{last_visit_date}',
  '{time}',
] as const;

export type WfTemplateApproval = 'approved' | 'pending' | 'rejected' | 'n/a';

export interface WfReminderStep {
  id: string;
  title: string;
  offset: string;
  channel: string;
  body: string;
  approval: WfTemplateApproval;
  templateName: string;
  enabled: boolean;
}

export const REMINDER_STEPS: WfReminderStep[] = [
  {
    id: 'rem-24h',
    title: '24-hour reminder',
    offset: '24 hours before the appointment',
    channel: 'WhatsApp, SMS fallback',
    body: REMINDER_24H,
    approval: 'approved',
    templateName: 'booking_reminder_24h_v3',
    enabled: true,
  },
  {
    id: 'rem-2h',
    title: '2-hour reminder',
    offset: '2 hours before the appointment',
    channel: 'WhatsApp, SMS fallback',
    body: REMINDER_2H,
    approval: 'approved',
    templateName: 'booking_reminder_2h_v1',
    enabled: true,
  },
  {
    id: 'rem-cancel',
    title: 'Cancellation reply',
    offset: 'Immediately after the patient replies CANCEL',
    channel: 'WhatsApp',
    body: CANCEL_REPLY,
    approval: 'pending',
    templateName: 'cancel_rebook_offer_v2',
    enabled: true,
  },
  {
    id: 'rem-noshow',
    title: 'No-show recovery',
    offset: '1 hour after the missed appointment',
    channel: 'WhatsApp, SMS fallback',
    body: NO_SHOW_MESSAGE,
    approval: 'rejected',
    templateName: 'no_show_rebook_v2',
    enabled: false,
  },
];

/** §12.1 — the spec's default rebooking intervals, per service. */
export interface WfIntervalRow {
  id: string;
  treatment: string;
  days: number;
  note?: string;
  patientsOnInterval: number;
}

export const REBOOK_INTERVALS: WfIntervalRow[] = [
  {
    id: 'int-1',
    treatment: 'Botox',
    days: 90,
    patientsOnInterval: 184,
  },
  {
    id: 'int-2',
    treatment: 'Dermal filler',
    days: 180,
    patientsOnInterval: 112,
  },
  { id: 'int-3', treatment: 'Facials', days: 28, patientsOnInterval: 96 },
  {
    id: 'int-4',
    treatment: 'Laser hair removal',
    days: 42,
    patientsOnInterval: 74,
  },
  { id: 'int-5', treatment: 'Chemical peel', days: 28, patientsOnInterval: 58 },
  {
    id: 'int-6',
    treatment: 'Body contouring',
    days: 14,
    note: 'During a course; 90 days for maintenance',
    patientsOnInterval: 27,
  },
];

/* ============================================================== §16 reviews */

export const REVIEW_PROMPT = `Hi {patient_first_name}, thank you for visiting {clinic_name}. We'd love to hear how your experience was. How would you rate your visit? Reply with a number from 1-5.`;

export const REVIEW_ROUTE_HIGH = `That's great to hear! Would you mind leaving us a quick review on Google? It really helps other people find us. {google_review_link}`;
export const REVIEW_ROUTE_MID =
  'Thank you for the feedback. Is there anything we could have done better? Your response will be sent to {owner_first_name} directly.';
export const REVIEW_ROUTE_LOW = `We're sorry to hear that. Your feedback has been sent directly to {owner_first_name} who will be in touch personally.`;

export interface WfRatingBucket {
  rating: number;
  count: number;
}

export const RATING_DISTRIBUTION: WfRatingBucket[] = [
  { rating: 5, count: 118 },
  { rating: 4, count: 41 },
  { rating: 3, count: 9 },
  { rating: 2, count: 4 },
  { rating: 1, count: 2 },
];

export interface WfFeedbackCard {
  id: string;
  name: string;
  rating: number;
  visit: string;
  treatment: string;
  practitioner: string;
  feedback: string;
  status: 'open' | 'assigned' | 'resolved';
  assignee?: string;
}

export const NEGATIVE_FEEDBACK: WfFeedbackCard[] = [
  {
    id: 'fb-1',
    name: 'Sofia Marchetti',
    rating: 2,
    visit: 'Yesterday, 11:30',
    treatment: 'Botox — full upper face',
    practitioner: 'Dr. Aoife Byrne',
    feedback:
      'I waited 35 minutes past my appointment time and nobody told me why. The treatment itself was fine but I had to leave work early for nothing.',
    status: 'open',
  },
  {
    id: 'fb-2',
    name: 'Laura Nwosu',
    rating: 1,
    visit: '3 days ago',
    treatment: 'Dermal filler — cheeks',
    practitioner: 'Nurse Ciara Walsh',
    feedback:
      'Still very swollen on one side five days on and I could not get anyone on the phone. I would like someone to call me.',
    status: 'assigned',
    assignee: 'Dr. Aoife Byrne',
  },
  {
    id: 'fb-3',
    name: 'Katie O’Donovan',
    rating: 3,
    visit: '6 days ago',
    treatment: 'Chemical peel — superficial',
    practitioner: 'Nurse Ciara Walsh',
    feedback:
      'Results were less noticeable than I expected for the price. Nothing went wrong, I just am not sure I would book it again.',
    status: 'resolved',
    assignee: 'Dr. Aoife Byrne',
  },
];

export interface WfResponseRow {
  id: string;
  name: string;
  rating: number;
  when: string;
  treatment: string;
  routedTo: string;
}

export const ALL_RESPONSES: WfResponseRow[] = [
  {
    id: 'res-1',
    name: 'Chloe Donnelly',
    rating: 5,
    when: 'Today, 07:20',
    treatment: 'Hydrafacial',
    routedTo: 'Google link sent',
  },
  {
    id: 'res-2',
    name: 'Sofia Marchetti',
    rating: 2,
    when: 'Yesterday, 11:31',
    treatment: 'Botox — full upper face',
    routedTo: 'Owner notified, task created',
  },
  {
    id: 'res-3',
    name: 'Isabelle Moreau',
    rating: 5,
    when: '2 days ago',
    treatment: 'Hydrafacial',
    routedTo: 'Google link sent, clicked',
  },
  {
    id: 'res-4',
    name: 'Daniel Osei',
    rating: 4,
    when: '3 days ago',
    treatment: 'Chemical peel — medium depth',
    routedTo: 'Google link sent',
  },
  {
    id: 'res-5',
    name: 'Laura Nwosu',
    rating: 1,
    when: '3 days ago',
    treatment: 'Dermal filler — cheeks',
    routedTo: 'Owner notified, task created',
  },
  {
    id: 'res-6',
    name: 'Katie O’Donovan',
    rating: 3,
    when: '6 days ago',
    treatment: 'Chemical peel — superficial',
    routedTo: 'Follow-up question sent',
  },
];

export interface WfGoogleClickRow {
  id: string;
  name: string;
  rating: number;
  linkSent: string;
  clicked: string;
}

export const GOOGLE_CLICKS: WfGoogleClickRow[] = [
  {
    id: 'gc-1',
    name: 'Isabelle Moreau',
    rating: 5,
    linkSent: '2 days ago',
    clicked: '2 days ago, 4 minutes later',
  },
  {
    id: 'gc-2',
    name: 'Daniel Osei',
    rating: 4,
    linkSent: '3 days ago',
    clicked: '3 days ago, 2 hours later',
  },
  {
    id: 'gc-3',
    name: 'Chloe Donnelly',
    rating: 5,
    linkSent: 'Today, 07:21',
    clicked: 'Not yet',
  },
];

/* ======================================================== §15 notifications */

export type WfNotifCategory =
  | 'Bookings'
  | 'Patients'
  | 'Payments'
  | 'Reviews'
  | 'Forms'
  | 'Tasks'
  | 'System';

export interface WfNotifType {
  id: string;
  label: string;
  /**
   * §15.3 — the three that can never be switched off. Rendered checked and
   * disabled with a tooltip rather than hidden, so the grid still tells the
   * truth about what the clinic will receive.
   */
  locked?: string;
  highPriority?: boolean;
  /** §5.5 — who receives it, independent of the channel axis. */
  recipients: string;
}

export const NOTIF_GROUPS: {
  category: WfNotifCategory;
  types: WfNotifType[];
}[] = [
  {
    category: 'Bookings',
    types: [
      {
        id: 'n-1',
        label: 'New booking confirmed',
        recipients: 'Practitioner + front desk',
      },
      {
        id: 'n-2',
        label: 'Booking cancelled',
        recipients: 'Practitioner + front desk',
      },
      {
        id: 'n-3',
        label: 'Booking rescheduled',
        recipients: 'Practitioner',
      },
      {
        id: 'n-4',
        label: 'Patient confirmed via reminder reply',
        recipients: 'Front desk',
      },
      { id: 'n-5', label: 'Walk-in added', recipients: 'Front desk' },
    ],
  },
  {
    category: 'Patients',
    types: [
      {
        id: 'n-6',
        label: 'No-show recorded',
        recipients: 'Practitioner + owner',
      },
      {
        id: 'n-7',
        label: 'No-show where a deposit or card charge applies',
        locked:
          'Money moves on this one. Always emailed so there is a record outside the app.',
        recipients: 'Owner',
      },
      {
        id: 'n-8',
        label: 'New patient registered',
        recipients: 'Front desk',
      },
      {
        id: 'n-9',
        label: 'Patient moved to “lapsed”',
        recipients: 'Owner',
      },
      { id: 'n-10', label: 'Patient moved to “lost”', recipients: 'Owner' },
    ],
  },
  {
    category: 'Payments',
    types: [
      { id: 'n-11', label: 'Deposit received', recipients: 'Front desk' },
      {
        id: 'n-12',
        label: 'Membership payment processed',
        recipients: 'Owner',
      },
      {
        id: 'n-13',
        label: 'Membership payment failed',
        locked:
          'A failed membership payment silently ends a subscription. Always emailed.',
        recipients: 'Owner',
      },
      { id: 'n-14', label: 'Package purchased', recipients: 'Owner' },
      {
        id: 'n-15',
        label: 'Manual card charge completed',
        recipients: 'Front desk',
      },
      {
        id: 'n-16',
        label: 'Outstanding balance overdue',
        recipients: 'Owner + front desk',
      },
    ],
  },
  {
    category: 'Reviews',
    types: [
      {
        id: 'n-17',
        label: 'Positive review (4–5 stars)',
        recipients: 'Owner',
      },
      {
        id: 'n-18',
        label: 'Negative feedback (1–3 stars)',
        locked:
          'The one thing that must not scroll past. Always emailed to the owner.',
        highPriority: true,
        recipients: 'Owner',
      },
      {
        id: 'n-19',
        label: 'New Google review posted (if trackable)',
        recipients: 'Owner',
      },
    ],
  },
  {
    category: 'Forms',
    types: [
      {
        id: 'n-20',
        label: 'Consent form completed',
        recipients: 'Practitioner',
      },
      {
        id: 'n-21',
        label: 'Consent form expiring within 30 days',
        recipients: 'Front desk',
      },
      {
        id: 'n-22',
        label: 'Medical history due for renewal',
        recipients: 'Front desk',
      },
    ],
  },
  {
    category: 'Tasks',
    types: [
      { id: 'n-23', label: 'Task assigned to you', recipients: 'Assignee' },
      { id: 'n-24', label: 'Task overdue', recipients: 'Assignee + owner' },
      {
        id: 'n-25',
        label: 'Escalation — task unresolved for 3 days',
        recipients: 'Owner',
      },
    ],
  },
  {
    category: 'System',
    types: [
      {
        id: 'n-26',
        label: 'Waitlist slot opened — patient notified',
        recipients: 'Front desk',
      },
      {
        id: 'n-27',
        label: 'Rebooking prompt sent',
        recipients: 'Nobody by default',
      },
      {
        id: 'n-28',
        label: 'Sequence step executed',
        recipients: 'Nobody by default',
      },
      {
        id: 'n-29',
        label: 'Skin analysis completed',
        recipients: 'Practitioner',
      },
    ],
  },
];

export interface WfDigestLine {
  label: string;
  value: string;
}

export const DAILY_DIGEST: WfDigestLine[] = [
  {
    label: 'Today’s appointments',
    value: '14 booked · 11 confirmed · 3 awaiting',
  },
  { label: 'Overnight', value: '2 bookings · 1 cancellation · 4 messages' },
  { label: 'Outstanding tasks', value: '3, one overdue since Monday' },
  { label: 'Alerts', value: '1 negative review (Sofia Marchetti, 2/5)' },
];

export const WEEKLY_DIGEST: WfDigestLine[] = [
  { label: 'Revenue', value: '£18,420 this week vs £16,905 last week' },
  { label: 'Clients', value: '37 new · 148 returning' },
  { label: 'Rebooking prompts', value: '62 sent · 24 booked · 21 ignored' },
  { label: 'Reviews', value: '19 responses · 4.6 average' },
  { label: 'Upcoming renewals', value: '6 memberships · 9 consent forms' },
];

/* ============================================================ §14 sequences */

export interface WfSequenceSummary {
  id: string;
  name: string;
  trigger: string;
  steps: number;
  active: number;
  completed: string;
  bookedFrom: string;
  paused: boolean;
  /** §14.1 — only Win-Back day 60 and Birthday expose an editable offer. */
  offer?: string;
}

export const SEQUENCES: WfSequenceSummary[] = [
  {
    id: 'seq-welcome',
    name: 'New Client Welcome',
    trigger: 'First-ever booking confirmed',
    steps: 4,
    active: 37,
    completed: '82% completed',
    bookedFrom: '11 rebooked',
    paused: false,
  },
  {
    id: 'seq-followup',
    name: 'Post-Treatment Follow-Up',
    trigger: 'Visit completed',
    steps: 3,
    active: 148,
    completed: '91% completed',
    bookedFrom: '46 rebooked',
    paused: false,
  },
  {
    id: 'seq-noshow',
    name: 'No-Show Recovery',
    trigger: 'Marked no-show',
    steps: 3,
    active: 6,
    completed: '74% completed',
    bookedFrom: '2 rebooked',
    paused: true,
  },
  {
    id: 'seq-winback',
    name: 'Lapsed Client Win-Back',
    trigger: 'No visit in 30+ days and no response to the rebooking prompt',
    steps: 3,
    active: 63,
    completed: '58% completed',
    bookedFrom: '9 rebooked',
    paused: false,
    offer: '10% off the next treatment',
  },
  {
    id: 'seq-birthday',
    name: 'Birthday',
    trigger: 'Date of birth',
    steps: 1,
    active: 412,
    completed: '—',
    bookedFrom: '18 rebooked',
    paused: false,
    offer: '£25 off any treatment this month',
  },
];

export type WfStepKind = 'whatsapp' | 'sms' | 'email' | 'task';

export interface WfBuilderStep {
  id: string;
  kind: WfStepKind;
  title: string;
  /** The edge chip ABOVE this card. Omitted on the first step. */
  delay?: string;
  preview: string;
  stats?: string;
}

/**
 * §14.2 — the Win-Back sequence opened in the builder. Delays are a property of
 * the step BELOW them, not their own list entries: the spec's timeline has no
 * branching, so a delay is an edge, and rendering it as a node makes a
 * three-message sequence read as six things to review.
 */
export const BUILDER_STEPS: WfBuilderStep[] = [
  {
    id: 'step-1',
    kind: 'whatsapp',
    title: 'Gentle return message',
    preview: LAPSED_MESSAGE,
    stats: '63 sent · 51 delivered · 29 read · 7 clicked · 3 replied',
  },
  {
    id: 'step-2',
    kind: 'whatsapp',
    title: 'Return message with offer',
    delay: 'Wait 30 days',
    preview:
      'Hi {patient_first_name}, we’d still love to see you back at {clinic_name}. Here’s 10% off your next treatment if you book this month: {booking_link}',
    stats: '41 sent · 38 delivered · 19 read · 6 clicked · 2 replied',
  },
  {
    id: 'step-3',
    kind: 'email',
    title: 'Final message',
    delay: 'Wait 30 days',
    preview:
      'Hi {patient_first_name}, this is the last we’ll email about booking again — if you change your mind you can always reach us at {clinic_name}. {booking_link}',
    stats: '29 sent · 28 delivered · 8 read · 1 clicked · 0 replied',
  },
  {
    id: 'step-4',
    kind: 'task',
    title: 'Mark as lost — no further automatic messages',
    delay: 'Wait 30 days',
    preview:
      'Creates a task for the front desk: “Review {patient_first_name} before archiving — lifetime spend {lifetime_spend}.”',
  },
];

export const STEP_PALETTE: { kind: WfStepKind; label: string; hint: string }[] =
  [
    {
      kind: 'whatsapp',
      label: 'Send WhatsApp',
      hint: 'Needs an approved template outside the 24-hour window',
    },
    { kind: 'sms', label: 'Send SMS', hint: 'Fallback when WhatsApp fails' },
    { kind: 'email', label: 'Send email', hint: 'No window restriction' },
    {
      kind: 'task',
      label: 'Create a task',
      hint: 'Assigned to a role, not a person',
    },
  ];

export const SEQUENCE_TRIGGERS = [
  'Booking confirmed',
  'Visit completed',
  'Marked no-show',
  'X days since last visit',
  'Tag added',
  'Membership activated',
  'Membership expiring',
] as const;

/**
 * Two palette entries that are NOT `WfStepKind`s, and the reason they are
 * separate: a delay is an EDGE between cards rather than a card, and a tag is
 * silent — it writes to the patient record and sends nothing, so it has no
 * template, no preview and no delivery stats. Modelling either as a step kind
 * would give it a content editor it can never use.
 */
export const PALETTE_EXTRAS: { id: string; label: string; hint: string }[] = [
  {
    id: 'delay',
    label: 'Add a delay',
    hint: 'Becomes an edge chip between two cards, not a card of its own',
  },
  {
    id: 'tag',
    label: 'Add a tag',
    hint: 'Writes to the patient record. Sends nothing, so it has no stats',
  },
];
