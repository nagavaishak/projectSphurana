/**
 * Static fixtures for the wireframe pages under `/wireframes`.
 *
 * These pages exist to review NEW booking surfaces in the real UI kit before
 * any of them get a backend. Nothing here calls an API, and nothing here should
 * ever be imported by a production route — if a surface graduates, it gets real
 * hooks and this module stops being its data source.
 *
 * The shape of each fixture deliberately mirrors what the eventual API would
 * return, so promoting a page is a matter of swapping the import rather than
 * rewriting the markup.
 */

export const ORG = {
  name: 'Acme Skin & Laser',
  slug: 'acme-skin',
  currencySymbol: '£',
  logoInitials: 'AS',
} as const;

export interface WfLocation {
  id: string;
  name: string;
  address: string;
  /** Rendered verbatim — the copy differs per state, so it is not derived. */
  statusLabel: string;
  status: 'open' | 'closed' | 'phone-only';
  phone?: string;
}

export const LOCATIONS: WfLocation[] = [
  {
    id: 'hanley',
    name: 'Pelham Street, Hanley',
    address: 'Pelham Street, Hanley, Stoke on Trent, ST1 3LL',
    statusLabel: 'Open until 6:00 pm',
    status: 'open',
  },
  {
    id: 'newcastle',
    name: 'Newcastle-under-Lyme',
    address: '12 High Street, Newcastle-under-Lyme, ST5 1QB',
    statusLabel: 'Open until 8:00 pm',
    status: 'open',
  },
  {
    id: 'stafford',
    name: 'Stafford',
    address: '4 Greengate Street, Stafford, ST16 2JA',
    statusLabel: 'Closed — opens tomorrow at 9:00 am',
    status: 'closed',
  },
  {
    id: 'crewe',
    name: 'Crewe',
    address: '88 Nantwich Road, Crewe, CW2 6AL',
    statusLabel: 'Phone bookings only',
    status: 'phone-only',
    phone: '01270 555 018',
  },
];

export const SPECIAL_OFFERS = [
  {
    id: 'offer-hydra',
    title: '20% off your first skin rejuvenation',
    body: 'New patients only. Applied automatically at checkout, ends 30 September.',
    ctaLabel: 'Book this offer',
  },
  {
    id: 'offer-iv',
    title: 'IV drip course — buy 5, get the 6th free',
    body: 'Available at Hanley and Stafford until the end of the month.',
    ctaLabel: 'See the course',
  },
];

export interface WfCourse {
  id: string;
  name: string;
  category: string;
  sessionCount: number;
  sessionServiceName: string;
  priceLabel: string;
  wasPriceLabel?: string;
  savingLabel?: string;
  validityLabel: string;
  /**
   * The gap rule the product owner flagged — two plain nullable ints on the
   * `course` table, exactly as they will be in the database. All customer-facing
   * copy is DERIVED from them (see `course-gap.ts`); nothing here is authored
   * text, so a course edited from 28 to 35 days cannot keep stale wording.
   */
  minDaysBetweenSessions: number | null;
  maxDaysBetweenSessions: number | null;
  /** Drives the "why" sentence. Derived from the service, not stored per course. */
  serviceKind: string | null;
}

export const COURSES: WfCourse[] = [
  {
    id: 'laser-legs-6',
    name: 'Laser Hair Removal — Full Legs',
    category: 'Laser & IPL',
    sessionCount: 6,
    sessionServiceName: 'Full Legs laser, 45 minutes each',
    priceLabel: '£900',
    wasPriceLabel: '£1,200',
    savingLabel: 'Save £300',
    validityLabel: 'Valid for 12 months from purchase',
    minDaysBetweenSessions: 28,
    maxDaysBetweenSessions: 42,
    serviceKind: 'laser',
  },
  {
    id: 'skin-rejuv-4',
    name: '4 × Skin Rejuvenation',
    category: 'Advanced skin',
    sessionCount: 4,
    sessionServiceName: 'Skin Rejuvenation, 30 minutes each',
    priceLabel: '£490',
    wasPriceLabel: '£580',
    savingLabel: 'Save £90',
    validityLabel: 'Valid for 12 months from purchase',
    minDaysBetweenSessions: 28,
    maxDaysBetweenSessions: null,
    serviceKind: 'peel',
  },
  {
    id: 'iv-drips-6',
    name: '6 × IV Drips',
    category: 'IV therapy',
    sessionCount: 6,
    sessionServiceName: 'IV Drip, 30 minutes each',
    priceLabel: '£450',
    wasPriceLabel: '£540',
    savingLabel: 'Save £90',
    validityLabel: 'Valid for 12 months from purchase',
    minDaysBetweenSessions: 7,
    maxDaysBetweenSessions: null,
    serviceKind: null,
  },
];

export type SessionState = 'completed' | 'booked' | 'bookable' | 'locked';

export interface WfCourseSession {
  index: number;
  state: SessionState;
  /** Set for completed and booked sessions. */
  whenLabel?: string;
  practitioner?: string;
  /** Set for the next bookable session — the clamped window. */
  windowLabel?: string;
  /** Set for locked sessions. */
  lockReason?: string;
}

export const COURSE_PURCHASE = {
  id: 'cp_9f21',
  course: COURSES[0],
  sessionsUsed: 2,
  expiresLabel: '14 March 2027',
  sessions: [
    {
      index: 1,
      state: 'completed',
      whenLabel: 'Wed 5 Mar, 2:00 pm',
      practitioner: 'Aoife Ryan',
    },
    {
      index: 2,
      state: 'completed',
      whenLabel: 'Wed 2 Apr, 2:00 pm',
      practitioner: 'Aoife Ryan',
    },
    {
      index: 3,
      state: 'booked',
      whenLabel: 'Wed 30 Apr, 2:00 pm',
      practitioner: 'Aoife Ryan',
    },
    { index: 4, state: 'bookable', windowLabel: '28 May – 11 June' },
    { index: 5, state: 'locked', lockReason: 'Book session 4 first' },
    { index: 6, state: 'locked', lockReason: 'Book session 5 first' },
  ] satisfies WfCourseSession[],
};

export const VOUCHER_AMOUNTS = ['£25', '£50', '£100', 'Other'] as const;

export interface WfProduct {
  id: string;
  brand: string;
  name: string;
  priceLabel: string;
  stock: 'in' | 'low' | 'out';
  lowStockLabel?: string;
}

export const PRODUCTS: WfProduct[] = [
  {
    id: 'p-mask',
    brand: 'Murad',
    name: 'Age Diffusing Firming Mask',
    priceLabel: '£89.00',
    stock: 'in',
  },
  {
    id: 'p-barrier',
    brand: 'Storyderm',
    name: 'Barrier Repair Cream',
    priceLabel: '£62.00',
    stock: 'out',
  },
  {
    id: 'p-deo',
    brand: 'Vico',
    name: 'Atlantic Sea Breeze Deodorant',
    priceLabel: '£13.50',
    stock: 'in',
  },
  {
    id: 'p-spf',
    brand: 'Isoclean',
    name: 'Daily SPF 50 Fluid',
    priceLabel: '£34.50',
    stock: 'low',
    lowStockLabel: 'Only 2 left',
  },
  {
    id: 'p-serum',
    brand: 'Murad',
    name: 'Hyaluronic Acid Serum',
    priceLabel: '£45.00',
    stock: 'in',
  },
  {
    id: 'p-cleanse',
    brand: 'Bia Belle',
    name: 'Gentle Foaming Cleanser',
    priceLabel: '£28.00',
    stock: 'out',
  },
];

export const BRAND_FILTERS = [
  { name: 'Bia Belle', count: 4 },
  { name: 'Isoclean', count: 6 },
  { name: 'Murad', count: 11 },
  { name: 'Storyderm', count: 3 },
  { name: 'Vico', count: 2 },
];

export const PATIENT = {
  firstName: 'Daniel',
  lastName: 'Cerasi',
  email: 'dcerasi06@gmail.com',
  phone: '+353 83 112 8681',
  cardLabel: 'Visa •••• 4242',
  cardExpiry: 'Expires 04/29',
} as const;

export interface WfBooking {
  id: string;
  serviceName: string;
  whenLabel: string;
  practitioner: string;
  locationName: string;
  confirmation: 'confirmed' | 'unconfirmed' | 'cancellation-requested';
  depositLabel?: string;
  consentOutstanding?: boolean;
  prepaidLabel?: string;
}

export const UPCOMING_BOOKINGS: WfBooking[] = [
  {
    id: 'A4K2B9',
    serviceName: 'Lip Filler Treatment',
    whenLabel: 'Wed 2 Sep · 9:00 am',
    practitioner: 'Dr. Eimear Treacy',
    locationName: 'Pelham Street, Hanley',
    confirmation: 'confirmed',
    depositLabel: 'Deposit paid £20',
    consentOutstanding: true,
  },
  {
    id: 'C8M4T1',
    serviceName: 'Laser Hair Removal — Full Legs',
    whenLabel: 'Wed 30 Apr · 2:00 pm',
    practitioner: 'Aoife Ryan',
    locationName: 'Pelham Street, Hanley',
    confirmation: 'unconfirmed',
    prepaidLabel: 'Course session 3 of 6',
  },
];

export const PAST_BOOKINGS: WfBooking[] = [
  {
    id: 'Z1P7Q2',
    serviceName: 'IV Drips',
    whenLabel: 'Tue 18 Aug 2026 · 9:00 am',
    practitioner: 'Aoife Ryan',
    locationName: 'Pelham Street, Hanley',
    confirmation: 'confirmed',
  },
];

/**
 * The booking being cancelled, and the org's policy — modelled on the columns
 * PR #848 lands, not on the original spec §6.4.
 *
 * That PR collapses the two legacy notice windows into ONE deadline governing
 * both cancel and reschedule, drops the never-charged late-cancel fee, and makes
 * the deposit outcome depend on a switch rather than on the deadline alone.
 */
export const CANCELLING = {
  booking: UPCOMING_BOOKINGS[0],
  depositLabel: '£20',
  /** organization.cancellation_reschedule_deadline_hours — 0 means no deadline. */
  cancellationRescheduleDeadlineHours: 24,
  /** organization.deposit_forfeit_on_late_cancel */
  depositForfeitOnLateCancel: true,
  /** organization.customer_cancellations_enabled */
  customerCancellationsEnabled: true,
  /** organization.customer_rescheduling_enabled */
  customerReschedulingEnabled: true,
  businessName: 'Acme Skin & Laser',
} as const;
/* ============================================================================
 * Booking flow — §23.3
 * ==========================================================================*/

export interface WfService {
  id: string;
  name: string;
  category: string;
  durationLabel: string;
  priceLabel: string;
  /** Omitted when the service takes no deposit — an empty badge reads as £0. */
  depositLabel?: string;
  note?: string;
}

export const SERVICE_CATEGORIES = [
  'Popular',
  'Injectables',
  'Laser & IPL',
  'Advanced skin',
  'IV therapy',
] as const;

export const SERVICES: WfService[] = [
  {
    id: 'svc-lip',
    name: 'Lip Filler Treatment',
    category: 'Injectables',
    durationLabel: '30 mins',
    priceLabel: '£180.00',
    depositLabel: '£20 deposit',
    note: 'Consultation included. Consent form required before treatment.',
  },
  {
    id: 'svc-consult',
    name: 'Skin Consultation',
    category: 'Advanced skin',
    durationLabel: '20 mins',
    priceLabel: 'Free',
  },
  {
    id: 'svc-laser-legs',
    name: 'Laser Hair Removal — Full Legs',
    category: 'Laser & IPL',
    durationLabel: '45 mins',
    priceLabel: '£200.00',
    depositLabel: '£20 deposit',
  },
  {
    id: 'svc-rejuv',
    name: 'Skin Rejuvenation',
    category: 'Advanced skin',
    durationLabel: '30 mins',
    priceLabel: '£145.00',
    depositLabel: '10% deposit',
  },
  {
    id: 'svc-iv',
    name: 'IV Drip — Energy Boost',
    category: 'IV therapy',
    durationLabel: '30 mins',
    priceLabel: '£90.00',
    depositLabel: 'Card on file',
  },
];

export interface WfPractitioner {
  id: string;
  name: string;
  role: string;
  initials: string;
  nextAvailableLabel: string;
}

/**
 * "Any available" is first and pre-selected (§23.3 step 2). It is modelled as a
 * row rather than as a toggle above the list so the fastest path is also the
 * default one — most patients do not have a preference.
 */
export const PRACTITIONERS: WfPractitioner[] = [
  {
    id: 'any',
    name: 'Any available',
    role: 'Fastest appointment',
    initials: '★',
    nextAvailableLabel: 'Next free: today at 4:30 pm',
  },
  {
    id: 'eimear',
    name: 'Dr. Eimear Treacy',
    role: 'Aesthetic doctor',
    initials: 'ET',
    nextAvailableLabel: 'Next free: Wed 2 Sep at 9:00 am',
  },
  {
    id: 'aoife',
    name: 'Aoife Ryan',
    role: 'Laser & skin therapist',
    initials: 'AR',
    nextAvailableLabel: 'Next free: Thu 3 Sep at 11:00 am',
  },
  {
    id: 'nuala',
    name: 'Nuala Byrne',
    role: 'Aesthetic nurse prescriber',
    initials: 'NB',
    nextAvailableLabel: 'Next free: Mon 7 Sep at 10:15 am',
  },
];

/**
 * The §5.6 booking window, in the two settings the day strip has to enforce.
 * Both are rendered as a REASON on the disabled day rather than as a missing
 * day — a date that silently vanishes reads as a bug, and the patient who
 * cannot see why rings the clinic to ask.
 */
export const BOOKING_WINDOW = {
  bufferHours: 4,
  maxAdvanceWeeks: 12,
  bufferReason: 'Too soon — we need 4 hours notice',
  maxAdvanceReason: 'More than 12 weeks ahead — opens 24 November',
  closedReason: 'Clinic closed',
  fullReason: 'Fully booked',
} as const;

export type WfDayState =
  | 'available'
  | 'selected'
  | 'full'
  | 'closed'
  | 'buffer'
  | 'beyond-max';

export interface WfDay {
  id: string;
  weekday: string;
  dayNumber: string;
  month: string;
  state: WfDayState;
  /** Required for every non-available day. Never left blank. */
  disabledReason?: string;
}

export const BOOKING_DAYS: WfDay[] = [
  {
    id: 'd-01',
    weekday: 'Mon',
    dayNumber: '1',
    month: 'Sep',
    state: 'buffer',
    disabledReason: BOOKING_WINDOW.bufferReason,
  },
  {
    id: 'd-02',
    weekday: 'Tue',
    dayNumber: '2',
    month: 'Sep',
    state: 'selected',
  },
  {
    id: 'd-03',
    weekday: 'Wed',
    dayNumber: '3',
    month: 'Sep',
    state: 'available',
  },
  {
    id: 'd-04',
    weekday: 'Thu',
    dayNumber: '4',
    month: 'Sep',
    state: 'full',
    disabledReason: BOOKING_WINDOW.fullReason,
  },
  {
    id: 'd-05',
    weekday: 'Fri',
    dayNumber: '5',
    month: 'Sep',
    state: 'available',
  },
  {
    id: 'd-06',
    weekday: 'Sat',
    dayNumber: '6',
    month: 'Sep',
    state: 'available',
  },
  {
    id: 'd-07',
    weekday: 'Sun',
    dayNumber: '7',
    month: 'Sep',
    state: 'closed',
    disabledReason: BOOKING_WINDOW.closedReason,
  },
  {
    id: 'd-08',
    weekday: 'Mon',
    dayNumber: '8',
    month: 'Sep',
    state: 'available',
  },
];

export interface WfSlot {
  time: string;
  /** Who would take it. Only shown when the patient picked "Any available". */
  practitioner: string;
}

export const SLOTS: { label: string; slots: WfSlot[] }[] = [
  {
    label: 'Morning',
    slots: [
      { time: '9:00 am', practitioner: 'Dr. Eimear Treacy' },
      { time: '9:45 am', practitioner: 'Nuala Byrne' },
      { time: '11:15 am', practitioner: 'Dr. Eimear Treacy' },
    ],
  },
  {
    label: 'Afternoon',
    slots: [
      { time: '1:30 pm', practitioner: 'Nuala Byrne' },
      { time: '2:15 pm', practitioner: 'Dr. Eimear Treacy' },
      { time: '4:00 pm', practitioner: 'Nuala Byrne' },
    ],
  },
  {
    label: 'Evening',
    slots: [{ time: '6:30 pm', practitioner: 'Dr. Eimear Treacy' }],
  },
];

/** The screen that decides whether demand is captured or lost (§23.3). */
export const FULLY_BOOKED = {
  dateLabel: 'Thursday 4 September',
  nextAvailableDateLabel: 'Friday 5 September',
  nextAvailableTimeLabel: '11:15 am',
  nextAvailablePractitioner: 'Nuala Byrne',
} as const;

/* ============================================================================
 * Deposit and confirmation — §10.2, §23.3 steps 5 and 6, §24
 * ==========================================================================*/

/**
 * Everything the deposit step needs across its six configurations.
 *
 * The percentage figures matter: §24 makes promo codes a PRICE MODIFIER applied
 * before the Stripe amount is computed, so a percentage deposit moves when the
 * code lands. Storing both numbers here keeps the recalculation visible in the
 * wireframe rather than implied.
 */
export const DEPOSIT = {
  serviceName: 'Lip Filler Treatment',
  whenLabel: 'Wed 2 Sep · 9:00 am',
  practitioner: 'Dr. Eimear Treacy',
  locationName: 'Pelham Street, Hanley',
  treatmentTotalLabel: '£180.00',
  fixedDepositLabel: '£20.00',
  balanceLabel: '£160.00',
  // A10 rules FIFTEEN minutes, not ten — ten is tight for finding a card on a
  // phone with 3DS, and hiding a constraint that will cost them the slot is
  // worse than the pressure of showing it.
  holdMinutes: 15,
  holdRemainingLabel: '13:41',
  percentLabel: '10%',
  percentDepositLabel: '£18.00',
  promoCode: 'AUTUMN20',
  promoDiscountLabel: '−£36.00',
  promoTotalLabel: '£144.00',
  promoDepositLabel: '£14.40',
  promoBalanceLabel: '£129.60',
  membershipName: 'Glow Membership',
  membershipCoverLabel:
    'Deposit waived — your membership covers this treatment',
  courseName: 'Laser Hair Removal — Full Legs',
  courseSessionLabel: 'Paid — course session 4 of 6',
} as const;

export const CONFIRMATION = {
  reference: 'A4K2B9',
  serviceName: 'Lip Filler Treatment',
  whenLabel: 'Wednesday 2 September, 9:00 am',
  durationLabel: '30 mins',
  practitioner: 'Dr. Eimear Treacy',
  locationName: 'Pelham Street, Hanley',
  address: 'Pelham Street, Hanley, Stoke on Trent, ST1 3LL',
  consentFormName: 'Dermal Filler Consent',
  consentDueLabel: 'Complete before Wed 2 September',
  preCare: [
    'Avoid alcohol and blood-thinning painkillers for 24 hours beforehand.',
    'Come with clean skin — no make-up on the treatment area.',
    'Tell us about any cold sores; we may prescribe antivirals first.',
  ],
  cancellationPolicyLabel:
    'Free to change or cancel online up to 24 hours before your appointment.',
} as const;

/* ============================================================================
 * Portal sign-in — §23.9
 * ==========================================================================*/

export const SIGN_IN = {
  /** Never confirms the account exists — enumeration is a real risk here. */
  neutralSentLabel:
    "If we have an account for that number, you'll get a code in a few seconds.",
  codeLength: 6,
  expiryMinutes: 10,
  resendSeconds: 42,
  maskedPhone: '+353 83 ••• 8681',
  maskedEmail: 'd••••••6@gmail.com',
} as const;

/* ============================================================================
 * Consent form — §23.10
 * ==========================================================================*/

export type WfConsentFieldKind =
  | 'text'
  | 'date'
  | 'long-text'
  | 'yes-no'
  | 'acknowledge';

export interface WfConsentField {
  id: string;
  label: string;
  kind: WfConsentFieldKind;
  placeholder?: string;
  help?: string;
  /** Rendered only when the parent yes/no is answered "Yes". */
  followUp?: { id: string; label: string; placeholder: string };
}

export interface WfConsentSection {
  id: string;
  title: string;
  blurb?: string;
  fields: WfConsentField[];
}

export const CONSENT_FORM = {
  formName: 'Dermal Filler Consent',
  patientFirstName: 'Daniel',
  forBookingLabel: 'Lip Filler Treatment · Wed 2 Sep, 9:00 am',
  expiresLabel: 'This link expires on 2 September',
  sections: [
    {
      id: 'about-you',
      title: 'About you',
      fields: [
        {
          id: 'full-name',
          label: 'Full name',
          kind: 'text',
          placeholder: 'Daniel Cerasi',
        },
        { id: 'dob', label: 'Date of birth', kind: 'date' },
      ],
    },
    {
      id: 'medical',
      title: 'Medical history',
      blurb: 'Answer for the last 12 months unless a question says otherwise.',
      fields: [
        {
          id: 'meds',
          label: 'Are you taking any regular medication?',
          kind: 'yes-no',
          followUp: {
            id: 'meds-detail',
            label: 'Which medications, and what dose?',
            placeholder: 'e.g. Levothyroxine 75mcg daily',
          },
        },
        {
          id: 'allergy',
          label: 'Do you have any allergies?',
          kind: 'yes-no',
          followUp: {
            id: 'allergy-detail',
            label: 'What are you allergic to?',
            placeholder: 'e.g. lidocaine, penicillin',
          },
        },
        {
          id: 'pregnant',
          label: 'Are you pregnant or breastfeeding?',
          kind: 'yes-no',
        },
      ],
    },
    {
      id: 'photos',
      /* §8.1 asks the two photo questions SEPARATELY — clinical record and
         marketing are different consents and bundling them is not consent. */
      title: 'Photographs',
      blurb:
        'These are two separate permissions. You can agree to one and not the other.',
      fields: [
        {
          id: 'photo-record',
          label:
            'I agree to before and after photos being kept in my clinical record.',
          kind: 'acknowledge',
        },
        {
          id: 'photo-marketing',
          label:
            'I agree to my photos being used in marketing, with my face obscured.',
          kind: 'acknowledge',
          help: 'Optional. You can withdraw this at any time.',
        },
      ],
    },
    {
      id: 'declaration',
      title: 'Declaration',
      fields: [
        {
          id: 'notes',
          label: 'Anything else we should know?',
          kind: 'long-text',
          placeholder: 'Optional',
        },
      ],
    },
  ] satisfies WfConsentSection[],
} as const;

/* ============================================================================
 * Shop product detail and checkout — §23.6
 * ==========================================================================*/

export const PRODUCT_DETAIL = {
  brand: 'Murad',
  name: 'Age Diffusing Firming Mask',
  priceLabel: '£89.00',
  sizeLabel: '50ml',
  stockLabel: 'In stock at Pelham Street, Hanley',
  outOfStockLabel: 'Out of stock at all locations',
  /** Placeholder tiles — no photography exists for the wireframe. */
  imageCount: 4,
  description:
    'A firming treatment mask that visibly lifts and smooths in ten minutes. Formulated for skin that has lost density, and safe to use the evening before an in-clinic treatment.',
  ingredients:
    'Aqua, Glycerin, Niacinamide, Retinyl Palmitate, Sodium Hyaluronate, Panthenol, Tocopherol, Citric Acid.',
  howToUse:
    'Apply an even layer to clean, dry skin. Leave for 10 minutes, then massage in any residue. Use twice a week, in the evening.',
} as const;

export const ORDER = {
  reference: 'ORD-4821',
  items: [
    {
      id: 'i-mask',
      name: 'Age Diffusing Firming Mask',
      brand: 'Murad',
      quantity: 1,
      lineTotalLabel: '£89.00',
    },
    {
      id: 'i-spf',
      name: 'Daily SPF 50 Fluid',
      brand: 'Isoclean',
      quantity: 2,
      lineTotalLabel: '£69.00',
    },
  ],
  subtotalLabel: '£158.00',
  totalLabel: '£158.00',
  collectionLocation: 'Pelham Street, Hanley',
  collectionReadyLabel: 'Ready to collect from tomorrow, 9:00 am',
  collectionHoursLabel: 'Mon–Fri 9:00 am – 6:00 pm · Sat 9:00 am – 4:00 pm',
} as const;

/* ============================================================================
 * Reschedule — §23.8, governed by PR #848 (§10.4)
 * ==========================================================================*/

export const RESCHEDULE = {
  booking: UPCOMING_BOOKINGS[0],
  /** Carried, never re-charged. */
  depositCarriedLabel: '£20.00',
  currentWhenLabel: 'Wed 2 Sep · 9:00 am',
  newWhenLabel: 'Fri 5 Sep · 2:15 pm',
} as const;

/* ============================================================================
 * Account sub-pages — §23.7
 * ==========================================================================*/

export interface WfPurchase {
  id: string;
  title: string;
  dateLabel: string;
  amountLabel: string;
  kind: 'Treatment' | 'Course' | 'Products' | 'Gift voucher';
  methodLabel: string;
  /** Set when part of the money came back. */
  refundLabel?: string;
}

/**
 * One list, every kind of money — a patient does not think of a deposit, a
 * course and a jar of moisturiser as three separate histories, and splitting
 * them is how "where is my receipt" becomes a phone call.
 */
export const PURCHASES: WfPurchase[] = [
  {
    id: 'r-1',
    title: 'Lip Filler Treatment — deposit',
    dateLabel: '28 Aug 2026',
    amountLabel: '£20.00',
    kind: 'Treatment',
    methodLabel: 'Visa •••• 4242',
  },
  {
    id: 'r-2',
    title: 'Murad Age Diffusing Firming Mask ×1, Isoclean Daily SPF 50 ×2',
    dateLabel: '21 Aug 2026',
    amountLabel: '£158.00',
    kind: 'Products',
    methodLabel: 'Visa •••• 4242',
  },
  {
    id: 'r-3',
    title: 'Laser Hair Removal — Full Legs, 6 sessions',
    dateLabel: '14 Mar 2026',
    amountLabel: '£900.00',
    kind: 'Course',
    methodLabel: 'Visa •••• 4242',
  },
  {
    id: 'r-4',
    title: 'Gift voucher for Sinéad Doyle',
    dateLabel: '2 Feb 2026',
    amountLabel: '£50.00',
    kind: 'Gift voucher',
    methodLabel: 'Apple Pay',
  },
  {
    id: 'r-5',
    title: 'IV Drip — Energy Boost',
    dateLabel: '18 Jan 2026',
    amountLabel: '£90.00',
    kind: 'Treatment',
    methodLabel: 'Visa •••• 4242',
    refundLabel: 'Refunded £90.00 on 20 Jan',
  },
];

/**
 * The five-value status vocabulary. "Sent" and "Opened" are separate on purpose:
 * a form that was opened and abandoned is a different problem from one that
 * never arrived, and the clinic chases them differently.
 */
export type WfFormStatus =
  | 'Not sent'
  | 'Sent'
  | 'Opened'
  | 'Completed'
  | 'Expired';

export interface WfFormRecord {
  id: string;
  name: string;
  status: WfFormStatus;
  meta: string;
  /** Only completed forms have something to read back. */
  hasPdf?: boolean;
}

export const FORM_RECORDS: WfFormRecord[] = [
  {
    id: 'f-1',
    name: 'Dermal Filler Consent',
    status: 'Sent',
    meta: 'Sent 28 Aug · for Wed 2 Sep',
  },
  {
    id: 'f-2',
    name: 'Photography Consent',
    status: 'Opened',
    meta: 'Opened 29 Aug, not finished',
  },
  {
    id: 'f-3',
    name: 'Medical History',
    status: 'Completed',
    meta: 'Completed 14 Mar 2026',
    hasPdf: true,
  },
  {
    id: 'f-4',
    name: 'Laser Patch Test Record',
    status: 'Expired',
    meta: 'Expired 1 Mar 2026 — annual renewal due',
  },
  {
    id: 'f-5',
    name: 'IV Therapy Screening',
    status: 'Not sent',
    meta: 'Needed before your next IV drip',
  },
];

export interface WfVoucherBalance {
  id: string;
  code: string;
  originalLabel: string;
  remainingLabel: string;
  /** Percentage remaining, for the bar. */
  remainingPercent: number;
  expiresLabel: string;
  counterpartyLabel: string;
}

export const VOUCHERS_BOUGHT: WfVoucherBalance[] = [
  {
    id: 'v-1',
    code: 'ASL-7QK4-22MB',
    originalLabel: '£50.00',
    remainingLabel: '£50.00',
    remainingPercent: 100,
    expiresLabel: 'Expires 2 February 2027',
    counterpartyLabel: 'Sent to Sinéad Doyle',
  },
];

export const VOUCHERS_RECEIVED: WfVoucherBalance[] = [
  {
    id: 'v-2',
    code: 'ASL-3HD9-81PT',
    originalLabel: '£100.00',
    remainingLabel: '£30.00',
    remainingPercent: 30,
    expiresLabel: 'Expires 11 December 2026',
    counterpartyLabel: 'From Marie Cerasi',
  },
];

/* ============================================================================
 * Consent link states — §23.10
 *
 * The four dead-end states are fixtures rather than derived, because each one
 * has a different next action and the copy is the whole design. In particular
 * the EXPIRED state never asks the patient to type a phone number: the token
 * already identifies them, so re-sending "to the number on file" leaks nothing
 * and asking for an identifier would turn a broken link into an enumeration
 * oracle.
 * ==========================================================================*/

export const CONSENT_STATES = {
  /** Masked, and only ever displayed — never an input. */
  maskedPhone: '•••• ••• 8681',
  submittedAtLabel: 'Submitted 29 August 2026 at 8:14 pm',
  expiredOnLabel: 'This link expired on 30 August 2026',
  renewalOfLabel: 'Laser Patch Test Record, completed 14 March 2026',
  renewalDueLabel: 'Annual renewal — due before your next laser session',
  savedAtLabel: 'Saved 2 minutes ago',
} as const;

/* ============================================================================
 * Reschedule policy — §23.8, governed by PR #848 (§10.4)
 *
 * Deliberately separate from `CANCELLING` so the reschedule surface cannot
 * quietly inherit cancel-specific fields. The deadline is the same column; the
 * consequence is not — a late CANCEL is allowed and may forfeit, a late
 * RESCHEDULE is refused outright.
 * ==========================================================================*/

export const RESCHEDULE_POLICY = {
  /** organization.cancellation_reschedule_deadline_hours */
  deadlineHours: 24,
  /** Rendered into the verbatim blocked copy — hours or days, as configured. */
  noticePeriodLabel: '24 hours',
  businessName: 'Acme Skin & Laser',
  clinicPhone: '01782 555 240',
  /** Hours until the appointment, in the blocked example. */
  hoursRemainingLabel: '9 hours',
} as const;

/* ============================================================================
 * Purchase history — §23.7
 *
 * One reverse-chronological ledger across every money type, with a settlement
 * status per row. Pending and failed both belong here: a patient whose card was
 * declined on a deposit finds out from this list or from a phone call, and the
 * list is cheaper.
 * ==========================================================================*/

export type WfPurchaseStatus = 'paid' | 'pending' | 'failed' | 'refunded';

export interface WfLedgerEntry extends WfPurchase {
  status: WfPurchaseStatus;
  /** Only settled payments have a receipt to open. */
  hasReceipt: boolean;
}

export const PURCHASE_LEDGER: WfLedgerEntry[] = [
  {
    id: 'l-0',
    title: 'Skin Rejuvenation — deposit',
    dateLabel: '31 Aug 2026',
    amountLabel: '£14.50',
    kind: 'Treatment',
    methodLabel: 'Visa •••• 4242',
    status: 'pending',
    hasReceipt: false,
  },
  { ...PURCHASES[0], status: 'paid', hasReceipt: true },
  { ...PURCHASES[1], status: 'paid', hasReceipt: true },
  {
    id: 'l-fail',
    title: 'IV Drip — Energy Boost, deposit',
    dateLabel: '3 Aug 2026',
    amountLabel: '£9.00',
    kind: 'Treatment',
    methodLabel: 'Visa •••• 4242 — declined',
    status: 'failed',
    hasReceipt: false,
  },
  { ...PURCHASES[2], status: 'paid', hasReceipt: true },
  { ...PURCHASES[3], status: 'paid', hasReceipt: true },
  { ...PURCHASES[4], status: 'refunded', hasReceipt: true },
];

/**
 * Why each form is needed, keyed by record id. Kept beside the status rather
 * than inside `meta` because "Sent 28 Aug" answers *when* and this answers
 * *why* — a patient who knows why a form matters completes it; one staring at
 * a bare title assumes it is admin and leaves it.
 */
export const FORM_REASONS: Record<string, string> = {
  'f-1': 'Required before your Lip Filler Treatment on Wed 2 Sep.',
  'f-2': 'Optional. Lets us keep before and after photos in your record.',
  'f-3': 'Kept on file so we can treat you safely. Reviewed each year.',
  'f-4': 'A patch test is required every 12 months before laser treatment.',
  'f-5': 'Needed before any IV therapy, to check for contraindications.',
};

/** A second bought voucher, so the delivery states are comparable. */
export const VOUCHERS_BOUGHT_EXTRA: WfVoucherBalance[] = [
  {
    id: 'v-3',
    code: 'ASL-5NW2-04KC',
    originalLabel: '£75.00',
    remainingLabel: '£75.00',
    remainingPercent: 100,
    expiresLabel: 'Expires 24 December 2027',
    counterpartyLabel: 'Sent to Marie Cerasi',
  },
];

export interface WfVoucherDelivery {
  /** Matches a `WfVoucherBalance.id`. */
  id: string;
  channelLabel: string;
  statusLabel: string;
  state: 'delivered' | 'scheduled' | 'failed';
}

export const VOUCHER_DELIVERY: WfVoucherDelivery[] = [
  {
    id: 'v-1',
    channelLabel: 'Emailed to sinead.doyle@gmail.com',
    statusLabel: 'Delivered 2 Feb 2026',
    state: 'delivered',
  },
  {
    id: 'v-3',
    channelLabel: 'Emailing marie.cerasi@gmail.com',
    statusLabel: 'Scheduled for 24 December, 8:00 am',
    state: 'scheduled',
  },
];
