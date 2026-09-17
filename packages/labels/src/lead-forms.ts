/**
 * Lead form enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Lead form status labels
export const leadFormStatusLabels = {
  draft: 'Draft',
  synced: 'Synced',
  error: 'Error',
  archived: 'Archived',
} as const;

export const leadFormStatusValues = Object.keys(leadFormStatusLabels) as [
  keyof typeof leadFormStatusLabels,
  ...(keyof typeof leadFormStatusLabels)[],
];

export type LeadFormStatus = keyof typeof leadFormStatusLabels;

// Lead form field type labels
export const leadFormFieldTypeLabels = {
  EMAIL: 'Email',
  PHONE: 'Phone',
  FULL_NAME: 'Full Name',
  FIRST_NAME: 'First Name',
  LAST_NAME: 'Last Name',
  CITY: 'City',
  STATE: 'State',
  COUNTRY: 'Country',
  ZIP: 'ZIP Code',
  STREET_ADDRESS: 'Street Address',
  DATE_OF_BIRTH: 'Date of Birth',
  GENDER: 'Gender',
  JOB_TITLE: 'Job Title',
  COMPANY_NAME: 'Company Name',
  WORK_EMAIL: 'Work Email',
  WORK_PHONE_NUMBER: 'Work Phone',
  CUSTOM: 'Custom Question',
} as const;

export const leadFormFieldTypeValues = Object.keys(leadFormFieldTypeLabels) as [
  keyof typeof leadFormFieldTypeLabels,
  ...(keyof typeof leadFormFieldTypeLabels)[],
];

export type LeadFormFieldType = keyof typeof leadFormFieldTypeLabels;

/**
 * The only field types Meta permits on a form that auto-starts a Messenger
 * conversation ("Start conversations on Messenger" —
 * `thank_you_page.enable_messenger`). One field outside this set and Meta
 * rejects the flag, so we drop it and the lead has to tap the thank-you-page
 * button instead — which almost nobody does.
 *
 * Lives here, beside `leadFormFieldTypeLabels`, because three layers need it:
 * the Meta client that sends the flag, the assistant adapter that reports
 * whether a form has it, and anything warning an owner before they add a
 * field that would switch it off.
 *
 * https://developers.facebook.com/docs/marketing-api/guides/lead-ads/create/
 */
export const messengerEligibleQuestionTypes = [
  'CUSTOM',
  'EMAIL',
  'FIRST_NAME',
  'FULL_NAME',
  'LAST_NAME',
  'PHONE',
] as const satisfies readonly LeadFormFieldType[];

export type MessengerEligibleQuestionType =
  (typeof messengerEligibleQuestionTypes)[number];

/** Field types that silently disable Messenger auto-start when added. */
export const messengerDisqualifyingQuestionTypes =
  leadFormFieldTypeValues.filter(
    (t) => !(messengerEligibleQuestionTypes as readonly string[]).includes(t)
  ) as Exclude<LeadFormFieldType, MessengerEligibleQuestionType>[];

/**
 * Field types whose Meta wire code differs from ours.
 *
 * Meta's `questions[].type` enum is its own vocabulary, and we send our type
 * through verbatim. Where the two disagree Meta rejects the WHOLE form with
 * `(#100) Param questions[n][type] must be one of {...}`, so a single
 * mismatched field makes the form unsyncable — that is what
 * `DATE_OF_BIRTH` did: Meta calls it `DOB`.
 *
 * Every other type in `leadFormFieldTypeLabels` matches Meta's enum verbatim
 * and needs no entry here.
 */
const metaQuestionTypeOverrides: Partial<Record<LeadFormFieldType, string>> = {
  DATE_OF_BIRTH: 'DOB',
};

/** Our field type as Meta's `questions[].type` wire value. */
export const toMetaQuestionType = (type: string): string =>
  metaQuestionTypeOverrides[type as LeadFormFieldType] ?? type;

const metaQuestionTypeReverse = Object.fromEntries(
  Object.entries(metaQuestionTypeOverrides).map(([ours, meta]) => [meta, ours])
) as Record<string, LeadFormFieldType>;

/**
 * Meta's `questions[].type` as ours. Used when reading a form back from Meta;
 * without it a `DOB` question returns as an unknown type and gets shown to the
 * owner as a generic custom question.
 */
export const fromMetaQuestionType = (type: string): string =>
  metaQuestionTypeReverse[type] ?? type;

/**
 * Whether a question set allows Meta's "Start conversations on Messenger".
 * An empty set is eligible — there is nothing disqualifying in it.
 */
export const isMessengerEligible = (
  questions: ReadonlyArray<{ type: string }>
): boolean =>
  questions.every((q) =>
    (messengerEligibleQuestionTypes as readonly string[]).includes(q.type)
  );

// A single question used to seed a new lead form. CUSTOM questions may carry
// a `label` and an `options` array; a CUSTOM question with options renders as
// a multiple-choice question on Meta's instant form.
export interface LeadFormDefaultQuestion {
  type: LeadFormFieldType;
  label?: string;
  key?: string;
  options?: Array<{ value: string; key?: string }>;
}

// The default field set for a brand-new lead form. Beyond the standard
// name/email/phone, we ask how soon the lead wants the treatment so the
// clinic can prioritise hot leads straight from the form submission.
export const defaultLeadFormQuestions: LeadFormDefaultQuestion[] = [
  { type: 'FULL_NAME' },
  { type: 'EMAIL' },
  { type: 'PHONE' },
  {
    type: 'CUSTOM',
    label: 'How soon are you hoping to get this treatment done?',
    key: 'treatment_timing',
    options: [
      { value: 'ASAP', key: 'asap' },
      { value: '1 week', key: '1_week' },
      { value: '2 weeks', key: '2_weeks' },
    ],
  },
];

// Instant-form lead-nurturing follow-up channel.
// Determines the chat CTA shown on the post-submission ("Thank you") screen.
// Maps to Meta's thank_you_page button_type when synced:
//   messenger -> P2B_MESSENGER, whatsapp -> WHATSAPP (+ business number).
export const leadFormFollowUpChannelLabels = {
  none: 'No follow-up chat',
  messenger: 'Chat on Messenger',
  whatsapp: 'Chat on WhatsApp',
} as const;

export const leadFormFollowUpChannelValues = Object.keys(
  leadFormFollowUpChannelLabels
) as [
  keyof typeof leadFormFollowUpChannelLabels,
  ...(keyof typeof leadFormFollowUpChannelLabels)[],
];

export type LeadFormFollowUpChannel =
  keyof typeof leadFormFollowUpChannelLabels;
