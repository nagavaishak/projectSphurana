/**
 * Fixtures for the calendar, money and client-record wireframes
 * (`docs/handoffs/booking-surfaces.md` §6, §7, §10).
 *
 * Same rule as the consultation fixtures next door: real names, real treatments
 * and real GBP amounts, because the whole point of reviewing §6.1's block
 * anatomy is whether "Priya Raghunathan · Lip filler 1ml" survives a 28px block
 * — and "Patient A · Treatment 1" survives anything, which is why placeholder
 * data hides exactly the problems these pages exist to find.
 *
 * One clinic (Harley Aesthetics, three practitioners) runs through all six
 * pages, and one patient — Nadia Osei — appears on the calendar, in the
 * deposits console AND on the client record, so a reviewer clicking between
 * them sees one story rather than six unrelated demos.
 */

/* ------------------------------------------------------- the day grid -- */

/**
 * The grid runs 09:00–18:00 at 1.8px per minute.
 *
 * That scale is chosen so the three rungs of §6.1's text ladder actually occur
 * on this page: a 15-minute block lands at 27px (<30px — name only, icons
 * collapse to a dot cluster), 30 minutes at 54px (two lines) and 45+ at 81px
 * (three lines). A rounder 2px/min would put 15 minutes at 30px and quietly
 * remove the tightest case from review.
 */
export const GRID_START_MIN = 9 * 60;
export const GRID_END_MIN = 18 * 60;
export const PX_PER_MIN = 1.8;

export const HOUR_MARKS = Array.from(
  { length: (GRID_END_MIN - GRID_START_MIN) / 60 + 1 },
  (_, i) => GRID_START_MIN + i * 60
);

export function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export interface WfPractitioner {
  id: string;
  name: string;
  short: string;
  initials: string;
  role: string;
  /** Minutes from midnight; hours outside this render as unavailable. */
  worksFrom: number;
  worksTo: number;
  /** Lunch or admin, rendered as a break band rather than a bookable gap. */
  breaks: { from: number; to: number; label: string }[];
  /** Two bookings sharing a slot — the column header carries the badge. */
  overlaps: number;
}

export const PRACTITIONERS: WfPractitioner[] = [
  {
    id: 'aoife',
    name: 'Dr. Aoife Byrne',
    short: 'Aoife',
    initials: 'AB',
    role: 'Aesthetic doctor',
    worksFrom: 9 * 60,
    worksTo: 17 * 60 + 30,
    breaks: [{ from: 13 * 60, to: 13 * 60 + 45, label: 'Lunch' }],
    overlaps: 1,
  },
  {
    id: 'marek',
    name: 'Marek Kowalczyk',
    short: 'Marek',
    initials: 'MK',
    role: 'Nurse prescriber',
    worksFrom: 10 * 60,
    worksTo: 18 * 60,
    breaks: [{ from: 14 * 60, to: 14 * 60 + 30, label: 'Lunch' }],
    overlaps: 0,
  },
  {
    id: 'chidi',
    name: 'Chidi Okafor',
    short: 'Chidi',
    initials: 'CO',
    role: 'Aesthetician',
    worksFrom: 9 * 60,
    worksTo: 16 * 60,
    breaks: [],
    overlaps: 0,
  },
];

/** §6.1 — the left border, and the only signal that is never omitted. */
/**
 * §6.1, amended by the A10 ruling.
 *
 * The original spec had grey = unconfirmed, with confirmation arriving only via
 * the 24-hour reminder reply — which rendered almost every appointment more than
 * a day out in grey, INCLUDING ones the clinic booked itself. A receptionist
 * booking someone stood at the desk is the highest-confidence booking in the
 * system, so that reading was backwards.
 *
 * So: staff-created bookings start `confirmed`. Only self-serve online bookings
 * start unconfirmed, and `awaiting_reply` separates "we asked and heard nothing"
 * — which is actionable, chase them — from "the reminder is not due yet", which
 * is not. Grey now means something.
 */
export type WfConfirmation =
  | 'confirmed'
  | 'unconfirmed'
  | 'awaiting_reply'
  | 'cancellation';

/**
 * §6.1 — `none` is the COMMON case for both deposit and consent, and means the
 * glyph is omitted entirely rather than drawn in a neutral colour. A block that
 * always carries three icons has taught the eye to ignore all three.
 */
export type WfDeposit = 'none' | 'paid' | 'unpaid';
export type WfConsent = 'none' | 'complete' | 'incomplete';

export interface WfBlock {
  id: string;
  practitionerId: string;
  startMin: number;
  durationMin: number;
  patient: string;
  treatment: string;
  price: string;
  confirmation: WfConfirmation;
  deposit: WfDeposit;
  consent: WfConsent;
  cardOnFile: boolean;
  /** §6.4 — dashed left border, and no deposit is ever taken. */
  walkIn?: boolean;
  /** Side-by-side at 50% width. `lane` 0 is the left half. */
  lane?: 0 | 1;
  status?: 'booked' | 'arrived' | 'in_progress' | 'completed';
}

export const DAY_BLOCKS: WfBlock[] = [
  {
    id: 'b1',
    practitionerId: 'aoife',
    startMin: 9 * 60,
    durationMin: 45,
    patient: 'Nadia Osei',
    treatment: 'Anti-wrinkle — 3 areas',
    price: '£280',
    confirmation: 'confirmed',
    deposit: 'paid',
    consent: 'complete',
    cardOnFile: true,
    status: 'in_progress',
  },
  {
    id: 'b2',
    practitionerId: 'aoife',
    startMin: 10 * 60,
    durationMin: 30,
    patient: 'Priya Raghunathan',
    treatment: 'Lip filler 1ml',
    price: '£240',
    confirmation: 'awaiting_reply',
    deposit: 'unpaid',
    consent: 'incomplete',
    cardOnFile: false,
  },
  // Two 11:00 bookings on one practitioner — the overlap case. Both render at
  // 50% width and the column header carries the count, because a badge on the
  // blocks themselves is invisible at the width they end up with.
  {
    id: 'b3',
    practitionerId: 'aoife',
    startMin: 11 * 60,
    durationMin: 60,
    patient: 'Eleanor Whitfield',
    treatment: 'Skin booster — full face',
    price: '£350',
    confirmation: 'confirmed',
    deposit: 'paid',
    consent: 'complete',
    cardOnFile: true,
    lane: 0,
  },
  {
    id: 'b4',
    practitionerId: 'aoife',
    startMin: 11 * 60,
    durationMin: 45,
    patient: 'Tomasz Wiśniewski',
    treatment: 'Review — follow-up',
    price: '£0',
    confirmation: 'unconfirmed',
    deposit: 'none',
    consent: 'none',
    cardOnFile: false,
    lane: 1,
  },
  {
    id: 'b5',
    practitionerId: 'aoife',
    startMin: 12 * 60 + 15,
    durationMin: 15,
    patient: 'Bilal Ahmed',
    treatment: 'Prescription review',
    price: '£30',
    confirmation: 'confirmed',
    deposit: 'none',
    consent: 'complete',
    cardOnFile: true,
  },
  {
    id: 'b6',
    practitionerId: 'aoife',
    startMin: 14 * 60,
    durationMin: 90,
    patient: 'Fiona Gallagher',
    treatment: 'Tear trough filler',
    price: '£450',
    confirmation: 'cancellation',
    deposit: 'paid',
    consent: 'complete',
    cardOnFile: true,
  },
  {
    id: 'b7',
    practitionerId: 'marek',
    startMin: 10 * 60,
    durationMin: 60,
    patient: 'Grace Adeyemi',
    treatment: 'Profhilo — course 1 of 2',
    price: '£320',
    confirmation: 'confirmed',
    deposit: 'paid',
    consent: 'complete',
    cardOnFile: false,
    status: 'arrived',
  },
  {
    id: 'b8',
    practitionerId: 'marek',
    startMin: 11 * 60 + 30,
    durationMin: 15,
    patient: 'Sam Cheung',
    treatment: 'Patch test',
    price: '£0',
    confirmation: 'confirmed',
    deposit: 'none',
    consent: 'none',
    cardOnFile: false,
  },
  {
    id: 'b9',
    practitionerId: 'marek',
    startMin: 12 * 60,
    durationMin: 30,
    patient: 'Róisín Delaney',
    treatment: 'Walk-in — consultation',
    price: '£0',
    confirmation: 'confirmed',
    deposit: 'none',
    consent: 'incomplete',
    cardOnFile: false,
    walkIn: true,
  },
  {
    id: 'b10',
    practitionerId: 'marek',
    startMin: 15 * 60,
    durationMin: 75,
    patient: 'Helena Marchetti',
    treatment: 'Cheek filler 2ml',
    price: '£520',
    confirmation: 'confirmed',
    deposit: 'unpaid',
    consent: 'complete',
    cardOnFile: true,
  },
  {
    id: 'b11',
    practitionerId: 'chidi',
    startMin: 9 * 60 + 30,
    durationMin: 60,
    patient: 'Amara Nwosu',
    treatment: 'Medical-grade peel',
    price: '£180',
    confirmation: 'confirmed',
    deposit: 'none',
    consent: 'complete',
    cardOnFile: true,
    status: 'completed',
  },
  {
    id: 'b12',
    practitionerId: 'chidi',
    startMin: 11 * 60,
    durationMin: 30,
    patient: 'Josie Pemberton',
    treatment: 'Dermaplaning',
    price: '£75',
    confirmation: 'confirmed',
    deposit: 'none',
    consent: 'none',
    cardOnFile: false,
  },
  {
    id: 'b13',
    practitionerId: 'chidi',
    startMin: 13 * 60,
    durationMin: 15,
    patient: 'Leo Fitzpatrick',
    treatment: 'LED add-on',
    price: '£40',
    confirmation: 'confirmed',
    deposit: 'none',
    consent: 'none',
    cardOnFile: true,
  },
  {
    id: 'b14',
    practitionerId: 'chidi',
    startMin: 14 * 60,
    durationMin: 45,
    patient: 'Yusuf Karim',
    treatment: 'Microneedling',
    price: '£210',
    confirmation: 'confirmed',
    deposit: 'paid',
    consent: 'complete',
    cardOnFile: true,
  },
];

/** The day summary strip. Counts are hand-set — nothing here is derived. */
export const DAY_SUMMARY = [
  { label: 'Booked', value: '14', sub: 'across 3 practitioners' },
  { label: 'Expected revenue', value: '£2,995', sub: '£830 deposits taken' },
  { label: 'Awaiting deposit', value: '2', sub: '£130 outstanding' },
  { label: 'Unconfirmed', value: '3', sub: 'reminder sent 24h ago' },
  { label: 'Free capacity', value: '31%', sub: '7 bookable slots left' },
];

/* ------------------------------------------------------ week capacity -- */

export const WEEK_DAYS = [
  { id: 'mon', label: 'Mon', date: '16' },
  { id: 'tue', label: 'Tue', date: '17' },
  { id: 'wed', label: 'Wed', date: '18' },
  { id: 'thu', label: 'Thu', date: '19' },
  { id: 'fri', label: 'Fri', date: '20' },
  { id: 'sat', label: 'Sat', date: '21' },
  { id: 'sun', label: 'Sun', date: '22' },
];

/**
 * §6.2 — the cell is a COUNT, coloured by remaining capacity, not a list of
 * bookings. `booked: null` is a non-working day and hatches; it is distinct
 * from a working day with zero bookings, which is the greenest cell on the
 * grid and the one an owner most wants to find.
 */
export interface WfWeekCell {
  booked: number | null;
  capacity: number;
}

export const WEEK_GRID: Record<string, WfWeekCell[]> = {
  aoife: [
    { booked: 8, capacity: 9 },
    { booked: 9, capacity: 9 },
    { booked: 6, capacity: 9 },
    { booked: 9, capacity: 9 },
    { booked: 7, capacity: 9 },
    { booked: 5, capacity: 6 },
    { booked: null, capacity: 0 },
  ],
  marek: [
    { booked: 4, capacity: 8 },
    { booked: 7, capacity: 8 },
    { booked: 8, capacity: 8 },
    { booked: 6, capacity: 8 },
    { booked: 8, capacity: 8 },
    { booked: null, capacity: 0 },
    { booked: null, capacity: 0 },
  ],
  chidi: [
    { booked: 2, capacity: 7 },
    { booked: 3, capacity: 7 },
    { booked: 5, capacity: 7 },
    { booked: 6, capacity: 7 },
    { booked: 7, capacity: 7 },
    { booked: 4, capacity: 7 },
    { booked: null, capacity: 0 },
  ],
};

/* ----------------------------------------------------------- walk-ins -- */

/** §6.4 — ordered by how often the clinic actually books them, not A–Z. */
export const WALK_IN_SERVICES = [
  { id: 'consult', name: 'Consultation', minutes: 20, price: 'Free' },
  { id: 'review', name: 'Review / top-up', minutes: 15, price: '£0' },
  { id: 'led', name: 'LED add-on', minutes: 20, price: '£40' },
  { id: 'dermaplane', name: 'Dermaplaning', minutes: 30, price: '£75' },
  { id: 'peel', name: 'Express peel', minutes: 30, price: '£95' },
  { id: 'patch', name: 'Patch test', minutes: 15, price: 'Free' },
  { id: 'brow', name: 'Brow shape', minutes: 20, price: '£28' },
  { id: 'skin', name: 'Skin scan', minutes: 15, price: '£25' },
];

export const WALK_IN_MATCHES = [
  { id: 'p1', name: 'Róisín Delaney', phone: '+44 7700 900412', visits: 6 },
  { id: 'p2', name: 'Rosie Donnelly', phone: '+44 7700 900188', visits: 1 },
];

/* ----------------------------------------------------------- deposits -- */

/**
 * §10 — one row per money movement. `forfeited` is the status added by PR #848
 * and is deliberately in the fixtures, because it is the one an owner has never
 * seen and the one that carries a keep-the-money decision behind it.
 */
export type WfDepositStatus =
  | 'paid'
  | 'pending'
  | 'refunded'
  | 'forfeited'
  | 'failed'
  | 'captured';

export interface WfDepositRow {
  id: string;
  patient: string;
  treatment: string;
  practitioner: string;
  /** Display string — these are fixtures, not money maths. */
  amount: string;
  status: WfDepositStatus;
  kind: 'deposit' | 'refund' | 'charge';
  when: string;
  appointment: string;
  note?: string;
}

export const DEPOSIT_ROWS: WfDepositRow[] = [
  {
    id: 'd1',
    patient: 'Nadia Osei',
    treatment: 'Anti-wrinkle — 3 areas',
    practitioner: 'Dr. Aoife Byrne',
    amount: '£50.00',
    status: 'paid',
    kind: 'deposit',
    when: '14 Mar, 08:12',
    appointment: 'Today 09:00',
  },
  {
    id: 'd2',
    patient: 'Priya Raghunathan',
    treatment: 'Lip filler 1ml',
    practitioner: 'Dr. Aoife Byrne',
    amount: '£60.00',
    status: 'pending',
    kind: 'deposit',
    when: '13 Mar, 19:40',
    appointment: 'Today 10:00',
    note: 'Link sent, not opened',
  },
  {
    id: 'd3',
    patient: 'Fiona Gallagher',
    treatment: 'Tear trough filler',
    practitioner: 'Dr. Aoife Byrne',
    amount: '£100.00',
    status: 'paid',
    kind: 'deposit',
    when: '9 Mar, 11:03',
    appointment: 'Today 14:00',
    note: 'Cancellation requested — inside the 24h deadline',
  },
  {
    id: 'd4',
    patient: 'Helena Marchetti',
    treatment: 'Cheek filler 2ml',
    practitioner: 'Marek Kowalczyk',
    amount: '£120.00',
    status: 'failed',
    kind: 'deposit',
    when: '13 Mar, 21:18',
    appointment: 'Today 15:00',
    note: 'Card declined — insufficient funds',
  },
  {
    id: 'd5',
    patient: 'Duncan Rae',
    treatment: 'Jawline filler',
    practitioner: 'Marek Kowalczyk',
    amount: '£90.00',
    status: 'forfeited',
    kind: 'deposit',
    when: '11 Mar, 16:55',
    appointment: '11 Mar 16:00',
    note: 'No-show, forfeit approved by Ciara Nolan',
  },
  {
    id: 'd6',
    patient: 'Yasmin Haddad',
    treatment: 'Profhilo',
    practitioner: 'Marek Kowalczyk',
    amount: '£80.00',
    status: 'refunded',
    kind: 'refund',
    when: '10 Mar, 09:26',
    appointment: '12 Mar 10:30',
    note: 'Cancelled 38h ahead — outside the deadline, released',
  },
  {
    id: 'd7',
    patient: 'Grace Adeyemi',
    treatment: 'Profhilo — course 1 of 2',
    practitioner: 'Marek Kowalczyk',
    amount: '£0.00',
    status: 'captured',
    kind: 'deposit',
    when: '7 Mar, 14:02',
    appointment: 'Today 10:00',
    note: '£0 deposit — card captured for no-show protection only',
  },
  {
    id: 'd8',
    patient: 'Yusuf Karim',
    treatment: 'Microneedling',
    practitioner: 'Chidi Okafor',
    amount: '£45.00',
    status: 'paid',
    kind: 'deposit',
    when: '12 Mar, 07:44',
    appointment: 'Today 14:00',
  },
  {
    id: 'd9',
    patient: 'Eleanor Whitfield',
    treatment: 'Skin booster — full face',
    practitioner: 'Dr. Aoife Byrne',
    amount: '£70.00',
    status: 'paid',
    kind: 'deposit',
    when: '6 Mar, 13:31',
    appointment: 'Today 11:00',
  },
  {
    id: 'd10',
    patient: 'Callum Baird',
    treatment: 'Late-cancellation balance',
    practitioner: 'Chidi Okafor',
    amount: '£35.00',
    status: 'paid',
    kind: 'charge',
    when: '5 Mar, 17:09',
    appointment: '5 Mar 16:30',
    note: 'Manual charge — balance due',
  },
];

export const DEPOSIT_TOTALS = [
  { label: 'Collected this month', value: '£1,845', sub: '23 deposits' },
  { label: 'Outstanding', value: '£180', sub: '2 links unpaid' },
  { label: 'Refunded', value: '£240', sub: '3 released outside deadline' },
  { label: 'Forfeited', value: '£90', sub: '1 no-show approved' },
  { label: 'Failed', value: '£120', sub: '1 needs a new card' },
];

/**
 * §10.4 — the no-show forfeit is NEVER automatic. A staff member marks the
 * no-show; keeping the money is a separate decision an owner makes here, which
 * is why this is a queue and not a toast.
 */
export interface WfNoShowRow {
  id: string;
  patient: string;
  treatment: string;
  amount: string;
  markedBy: string;
  markedAt: string;
  appointment: string;
  history: string;
}

export const NO_SHOW_QUEUE: WfNoShowRow[] = [
  {
    id: 'n1',
    patient: 'Duncan Rae',
    treatment: 'Jawline filler',
    amount: '£90.00',
    markedBy: 'Marek Kowalczyk',
    markedAt: '11 Mar, 16:20',
    appointment: '11 Mar 16:00',
    history: '3rd no-show in 12 months',
  },
  {
    id: 'n2',
    patient: 'Josie Pemberton',
    treatment: 'Dermaplaning',
    amount: '£25.00',
    markedBy: 'Chidi Okafor',
    markedAt: '13 Mar, 11:35',
    appointment: '13 Mar 11:00',
    history: 'First no-show · 9 visits',
  },
  {
    id: 'n3',
    patient: 'Sam Cheung',
    treatment: 'Consultation',
    amount: '£20.00',
    markedBy: 'Dr. Aoife Byrne',
    markedAt: '12 Mar, 09:50',
    appointment: '12 Mar 09:30',
    history: 'Rang ahead — reception logged "running late"',
  },
];

/** §10.3 — presets, so a reason is one tap and stays queryable later. */
export const CHARGE_REASONS = [
  'No-show fee',
  'Late cancellation',
  'Product purchase',
  'Balance due',
];

export const CHARGE_AMOUNTS = ['£25', '£50', '£75', '£100'];

/* ------------------------------------------------------ client record -- */

export const CLIENT = {
  name: 'Nadia Osei',
  initials: 'NO',
  phone: '+44 7700 900341',
  email: 'nadia.osei@gmail.com',
  dob: '4 Feb 1987 (39)',
  address: '18 Marchmont Street, London WC1N',
  source: 'Borradh Ads',
  firstVisit: '22 Jan 2024',
  lastVisit: '14 Mar 2026 (today)',
  visits: 17,
  spend: '£4,720',
  averageSpend: '£278',
  cardOnFile: true,
  membership: 'Glow Club — £79/mo, renews 1 Apr 2026',
  tags: ['VIP', 'Membership holder', 'Injectables'],
} as const;

/**
 * §7.2 — the alert strip. Each item names the tab that RESOLVES it, because an
 * alert you cannot act on from where it appears is just an anxiety generator.
 */
export const CLIENT_ALERTS = [
  {
    id: 'a1',
    tone: 'warn' as const,
    text: 'Medical history last updated 14 months ago — due for renewal.',
    action: 'Open Forms',
  },
  {
    id: 'a2',
    tone: 'info' as const,
    text: 'Membership renews in 18 days — 1 of 2 monthly sessions used.',
    action: 'Open Billing',
  },
  {
    id: 'a3',
    tone: 'bad' as const,
    text: 'Balance of £120 outstanding from 14 Mar treatment.',
    action: 'Open Billing',
  },
];

export interface WfVisit {
  id: string;
  date: string;
  treatment: string;
  practitioner: string;
  cost: string;
  products: { name: string; dose: string; lot: string; expiry: string }[];
  notes: string;
  photos: number;
  faceMap: boolean;
}

export const CLIENT_VISITS: WfVisit[] = [
  {
    id: 'v1',
    date: '14 Mar 2026',
    treatment: 'Anti-wrinkle — 3 areas',
    practitioner: 'Dr. Aoife Byrne',
    cost: '£280',
    products: [
      {
        name: 'Botox (onabotulinumtoxinA)',
        dose: '12u glabella',
        lot: 'C8421A',
        expiry: '09/2026',
      },
      {
        name: 'Botox (onabotulinumtoxinA)',
        dose: '8u frontalis',
        lot: 'C8421A',
        expiry: '09/2026',
      },
      {
        name: 'Botox (onabotulinumtoxinA)',
        dose: '10u crow’s feet',
        lot: 'C8421A',
        expiry: '09/2026',
      },
    ],
    notes:
      'Slight asymmetry right brow, corrected with 2u extra. Patient reports full effect by day 10 previously. Review booked 2 weeks.',
    photos: 4,
    faceMap: true,
  },
  {
    id: 'v2',
    date: '9 Jan 2026',
    treatment: 'Lip filler 1ml',
    practitioner: 'Dr. Aoife Byrne',
    cost: '£240',
    products: [
      {
        name: 'Juvéderm Volift',
        dose: '1.0ml',
        lot: 'JV-77321',
        expiry: '02/2027',
      },
      {
        name: 'Lidocaine 2%',
        dose: '0.3ml',
        lot: 'LD-9908',
        expiry: '11/2026',
      },
    ],
    notes:
      'Vermilion border definition, conservative volume as requested. Mild bruising lower left, resolved by day 4.',
    photos: 6,
    faceMap: true,
  },
  {
    id: 'v3',
    date: '3 Nov 2025',
    treatment: 'Profhilo — session 2 of 2',
    practitioner: 'Marek Kowalczyk',
    cost: '£320',
    products: [
      {
        name: 'Profhilo H+L',
        dose: '2.0ml',
        lot: 'PF-4410',
        expiry: '05/2026',
      },
    ],
    notes:
      'BAP technique, 5 points per side. Good hydration response since session 1. Recommend repeat course in 6 months.',
    photos: 2,
    faceMap: false,
  },
  {
    id: 'v4',
    date: '18 Aug 2025',
    treatment: 'Medical-grade peel',
    practitioner: 'Chidi Okafor',
    cost: '£180',
    products: [
      {
        name: 'ZO 3-Step Stimulation',
        dose: 'Full face',
        lot: 'ZO-2231',
        expiry: '01/2027',
      },
    ],
    notes:
      'Fitzpatrick IV — prepped 4 weeks with retinol. Mild erythema, no PIH at 2-week check.',
    photos: 3,
    faceMap: false,
  },
];

export const CLIENT_UPCOMING = [
  {
    id: 'u1',
    when: '28 Mar 2026, 10:30',
    treatment: 'Anti-wrinkle review',
    practitioner: 'Dr. Aoife Byrne',
    status: 'Confirmed',
  },
  {
    id: 'u2',
    when: '18 Apr 2026, 14:00',
    treatment: 'Profhilo — new course',
    practitioner: 'Marek Kowalczyk',
    status: 'Awaiting deposit',
  },
];

export const CLIENT_FORMS = [
  {
    id: 'f1',
    name: 'Medical history',
    sent: '2 Jan 2025',
    completed: '2 Jan 2025',
    status: 'Due for renewal',
  },
  {
    id: 'f2',
    name: 'Botulinum toxin consent',
    sent: '13 Mar 2026',
    completed: '13 Mar 2026',
    status: 'Completed',
  },
  {
    id: 'f3',
    name: 'Photography & marketing consent',
    sent: '9 Jan 2026',
    completed: '9 Jan 2026',
    status: 'Completed',
  },
  {
    id: 'f4',
    name: 'Dermal filler consent',
    sent: '12 Mar 2026',
    completed: '—',
    status: 'Opened',
  },
];

export const CLIENT_PAYMENTS = [
  {
    id: 'p1',
    date: '14 Mar 2026',
    amount: '£160.00',
    treatment: 'Anti-wrinkle — balance',
    method: 'Card ···4242',
    status: 'Outstanding',
  },
  {
    id: 'p2',
    date: '14 Mar 2026',
    amount: '£50.00',
    treatment: 'Anti-wrinkle — deposit',
    method: 'Card ···4242',
    status: 'Paid',
  },
  {
    id: 'p3',
    date: '1 Mar 2026',
    amount: '£79.00',
    treatment: 'Glow Club membership',
    method: 'Card ···4242',
    status: 'Paid',
  },
  {
    id: 'p4',
    date: '9 Jan 2026',
    amount: '£240.00',
    treatment: 'Lip filler 1ml',
    method: 'Card ···4242',
    status: 'Paid',
  },
];

export const CLIENT_COMMS = [
  {
    id: 'c1',
    channel: 'WhatsApp',
    author: 'Claire (AI)',
    when: 'Today, 07:30',
    body: 'Morning Nadia — you’re booked with Dr. Aoife at 09:00 today. Reply CONFIRM to keep it.',
  },
  {
    id: 'c2',
    channel: 'WhatsApp',
    author: 'Nadia Osei',
    when: 'Today, 07:34',
    body: 'CONFIRM',
  },
  {
    id: 'c3',
    channel: 'Email',
    author: 'Ciara Nolan',
    when: '13 Mar, 16:02',
    body: 'Consent form for tomorrow attached — takes about two minutes on your phone.',
  },
  {
    id: 'c4',
    channel: 'Instagram DM',
    author: 'Claire (AI)',
    when: '2 Mar, 20:11',
    body: 'Your Glow Club session for March is still available — want me to find a time?',
  },
];

/** The side panel's audit trail. Append-only, per §27. */
export const ACTIVITY_LOG = [
  {
    id: 'l1',
    when: 'Today, 09:04',
    who: 'Dr. Aoife Byrne',
    what: 'Marked in progress',
  },
  {
    id: 'l2',
    when: 'Today, 08:56',
    who: 'Ciara Nolan',
    what: 'Marked arrived',
  },
  {
    id: 'l3',
    when: 'Today, 07:34',
    who: 'Nadia Osei',
    what: 'Confirmed by WhatsApp',
  },
  {
    id: 'l4',
    when: 'Today, 08:12',
    who: 'Stripe',
    what: 'Deposit £50.00 captured',
  },
  {
    id: 'l5',
    when: '6 Mar, 13:29',
    who: 'Ciara Nolan',
    what: 'Booking created — source: Borradh Ads',
  },
];

/**
 * §10.3 — the three amounts a receptionist actually reaches for, with the
 * figure already worked out. Free text stays available, but typing "230" from
 * memory is how the wrong amount gets charged: the balance due is the treatment
 * price minus the deposit already taken, and nobody does that subtraction
 * correctly under pressure.
 */
export const CHARGE_QUICK_AMOUNTS = [
  {
    id: 'balance',
    label: 'Balance due',
    amount: '230.00',
    sub: 'Anti-wrinkle — 3 areas £280, less the £50 deposit already taken',
  },
  {
    id: 'noshow',
    label: 'No-show fee',
    amount: '25.00',
    sub: 'Clinic default',
  },
  {
    id: 'full',
    label: 'Full price',
    amount: '280.00',
    sub: 'Anti-wrinkle — 3 areas',
  },
];
