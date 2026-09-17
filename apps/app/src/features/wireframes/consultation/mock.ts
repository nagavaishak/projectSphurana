/**
 * Fixtures for the consultation, face-mapping, photo and skin-analysis
 * wireframes (`docs/handoffs/booking-surfaces.md` §8, §9, §19).
 *
 * Real names, real products, real lot numbers and real dosages, because the
 * point of the annotation canvas review is whether a practitioner can read a
 * pin at a glance — and "Product A, 10 units, Lot 123" reads fine while
 * "Botox, 12u, Lot ABC123-24 (exp 04/2026)" is the string that actually has to
 * fit. Placeholder data hides the layout problems these pages exist to find.
 *
 * One patient runs through every page (Sarah Whelan, a 12-month anti-wrinkle
 * programme) so a reviewer clicking consultation → annotate → sign-off →
 * compare → photos sees one coherent record instead of five unrelated demos.
 */

export const PATIENT = {
  name: 'Sarah Whelan',
  initials: 'SW',
  age: 41,
  treatment: 'Anti-wrinkle — upper face',
  practitioner: 'Dr. Aoife Byrne',
  date: '14 Mar 2026',
  visit: 'Visit #7 · 14 Mar 2026, 10:30',
} as const;

/* ------------------------------------------------------------- consent -- */

/** §8.1 — the last recorded answer, which pre-fills the gate. */
export const PRIOR_CONSENT = {
  clinical: true,
  marketing: true,
  answeredOn: '8 Nov 2025',
} as const;

/* ------------------------------------------------------------- capture -- */

export type AngleId = 'frontal' | 'left_profile' | 'right_profile';

export interface WfAngle {
  id: AngleId;
  label: string;
  /** Copy for the on-screen alignment markers, which differ per slot (§8.2). */
  guide: string;
  captured: boolean;
  /** Whether a same-angle photo exists to ghost against. */
  ghostFrom?: string;
}

export const ANGLES: WfAngle[] = [
  {
    id: 'frontal',
    label: 'Frontal',
    guide:
      'Eyes level with the bar · nose on the centre line · chin in the cup',
    captured: true,
    ghostFrom: '8 Nov 2025',
  },
  {
    id: 'left_profile',
    label: 'Left profile 45°',
    guide: 'Ear tip on the left marker · nose tip clear of the outline',
    captured: true,
    ghostFrom: '8 Nov 2025',
  },
  {
    id: 'right_profile',
    label: 'Right profile 45°',
    guide: 'Ear tip on the right marker · nose tip clear of the outline',
    captured: false,
    // No prior right profile: the ghost control disables rather than ghosting
    // the wrong angle, which would defeat the alignment it exists to give.
    ghostFrom: undefined,
  },
];

/** §8.2 — prior consultations for the ghost source sheet. */
export const GHOST_SOURCES = [
  { id: 'g1', label: 'Baseline — 8 Nov 2025', note: 'First consultation' },
  { id: 'g2', label: '17 Jan 2026', note: 'Second cycle' },
  { id: 'g3', label: '8 Nov 2025', note: 'Most recent frontal' },
];

/* ---------------------------------------------------------- annotation -- */

export interface WfPin {
  /** Numbering leaves gaps on delete (§8.4) — pin ④ was erased mid-session. */
  n: number;
  x: number;
  y: number;
  label: string;
  product?: string;
  dose?: string;
  lot?: string;
  expiry?: string;
  depth?: string;
  note?: string;
  /** Hollow on the canvas, and blocks sign-off. */
  incomplete?: boolean;
  /** Lot inherited from an earlier pin of the same product. */
  lotFromPin?: number;
  expiredLot?: boolean;
}

export const PINS: WfPin[] = [
  {
    n: 1,
    x: 50,
    y: 30,
    label: 'Glabella',
    product: 'Botox 100u',
    dose: '12 units',
    lot: 'C4821X',
    expiry: '09/2026',
    depth: 'Mid',
    note: 'Strong corrugator activity, up 2u from January.',
  },
  {
    n: 2,
    x: 38,
    y: 22,
    label: 'Frontalis — left',
    product: 'Botox 100u',
    dose: '4 units',
    lot: 'C4821X',
    expiry: '09/2026',
    depth: 'Superficial',
    lotFromPin: 1,
  },
  {
    n: 3,
    x: 62,
    y: 22,
    label: 'Frontalis — right',
    product: 'Botox 100u',
    dose: '4 units',
    lot: 'C4821X',
    expiry: '09/2026',
    depth: 'Superficial',
    lotFromPin: 1,
  },
  {
    n: 5,
    x: 27,
    y: 38,
    label: "Crow's feet — left",
    product: 'Botox 100u',
    dose: '8 units',
    lot: 'C4821X',
    expiry: '09/2026',
    depth: 'Superficial',
    lotFromPin: 1,
  },
  {
    n: 6,
    x: 73,
    y: 38,
    label: "Crow's feet — right",
    product: 'Botox 100u',
    dose: '8 units',
    lot: 'C4821X',
    expiry: '09/2026',
    depth: 'Superficial',
    lotFromPin: 1,
  },
  {
    n: 7,
    x: 40,
    y: 62,
    label: 'Nasolabial — left',
    product: 'Juvéderm Voluma XC',
    dose: '0.4 ml',
    lot: 'JV-77204',
    expiry: '02/2026',
    depth: 'Deep',
    // Warn, never block (§8.4) — the record has to reflect what happened.
    expiredLot: true,
  },
  {
    n: 8,
    x: 60,
    y: 62,
    label: 'Nasolabial — right',
    incomplete: true,
  },
];

export const ZONES = [
  { id: 'z1', label: 'Glabella', colour: 'red' },
  { id: 'z2', label: 'Frontalis', colour: 'blue' },
  { id: 'z3', label: "Crow's feet L/R", colour: 'green' },
];

/** Per-product totals for the right rail (§8.4) and the sign-off summary. */
export const DOSE_TOTALS = [
  { product: 'Botox 100u', total: '36 units', pins: 5, lot: 'C4821X' },
  { product: 'Juvéderm Voluma XC', total: '0.4 ml', pins: 1, lot: 'JV-77204' },
];

export const PRODUCT_OPTIONS = [
  'Botox 100u',
  'Bocouture 50u',
  'Juvéderm Voluma XC',
  'Juvéderm Volbella XC',
  'Restylane Kysse',
  'Profhilo H+L',
];

/* ---------------------------------------------------------- comparison -- */

export const COMPARE_SIDES = {
  left: {
    date: '8 Nov 2025',
    caption: 'Baseline',
    practitioner: 'Dr. Aoife Byrne',
    pins: 4,
    botox: '28 units',
  },
  right: {
    date: '14 Mar 2026',
    caption: 'Today',
    practitioner: 'Dr. Aoife Byrne',
    pins: 7,
    botox: '36 units',
  },
} as const;

export const COMPARE_DELTAS = [
  { zone: 'Glabella', from: '10 units', to: '12 units', change: '+2' },
  { zone: 'Frontalis', from: '10 units', to: '8 units', change: '−2' },
  { zone: "Crow's feet", from: '8 units', to: '16 units', change: '+8' },
  { zone: 'Nasolabial', from: '—', to: '0.4 ml', change: 'New' },
];

/* -------------------------------------------------------------- photos -- */

export interface WfPhoto {
  id: string;
  stage: 'Before' | 'During' | 'After';
  area: string;
  marketing: boolean;
  synced: boolean;
}

export interface WfPhotoVisit {
  visit: string;
  date: string;
  treatment: string;
  photos: WfPhoto[];
}

export const PHOTO_VISITS: WfPhotoVisit[] = [
  {
    visit: 'Visit #7',
    date: '14 Mar 2026',
    treatment: 'Anti-wrinkle — upper face',
    photos: [
      {
        id: 'p1',
        stage: 'Before',
        area: 'Face — frontal',
        marketing: true,
        synced: false,
      },
      {
        id: 'p2',
        stage: 'Before',
        area: 'Face — left 45°',
        marketing: true,
        synced: false,
      },
      {
        id: 'p3',
        stage: 'During',
        area: 'Face — frontal',
        marketing: false,
        synced: true,
      },
    ],
  },
  {
    visit: 'Visit #5',
    date: '17 Jan 2026',
    treatment: 'Anti-wrinkle + dermal filler',
    photos: [
      {
        id: 'p4',
        stage: 'Before',
        area: 'Face — frontal',
        marketing: true,
        synced: true,
      },
      {
        id: 'p5',
        stage: 'After',
        area: 'Face — frontal',
        marketing: false,
        synced: true,
      },
    ],
  },
  {
    visit: 'Visit #1',
    date: '8 Nov 2025',
    treatment: 'Consultation + anti-wrinkle',
    photos: [
      {
        id: 'p6',
        stage: 'Before',
        area: 'Face — frontal',
        marketing: true,
        synced: true,
      },
      {
        id: 'p7',
        stage: 'Before',
        area: 'Face — right 45°',
        marketing: true,
        synced: true,
      },
    ],
  },
];

/* ------------------------------------------------------- skin analysis -- */

export interface WfMetricRow {
  name: string;
  score: number;
  severity: 'Minimal' | 'Mild' | 'Moderate' | 'Significant';
  areas: string;
  explanation: string;
  previous?: number;
}

/**
 * Nine of twelve, deliberately. §19.4 asks for a partial result to be shown
 * honestly, and a fixture set that always returns all twelve never gets the
 * "3 metrics unavailable" row designed.
 */
export const SKIN_METRICS: WfMetricRow[] = [
  {
    name: 'Wrinkles / fine lines',
    score: 4,
    severity: 'Mild',
    areas: 'Forehead, glabella',
    explanation: 'Dynamic lines on the forehead, static lines at rest reduced.',
    previous: 7,
  },
  {
    name: 'Pigmentation / dark spots',
    score: 6,
    severity: 'Moderate',
    areas: 'Cheeks, upper lip',
    explanation: 'Scattered melasma-pattern pigment across both cheeks.',
    previous: 6,
  },
  {
    name: 'Pores',
    score: 3,
    severity: 'Minimal',
    areas: 'Nose, inner cheeks',
    explanation: 'Slightly enlarged in the T-zone, within normal range.',
    previous: 4,
  },
  {
    name: 'Skin texture',
    score: 3,
    severity: 'Minimal',
    areas: 'Cheeks',
    explanation: 'Smooth overall with mild roughness on the lateral cheeks.',
    previous: 5,
  },
  {
    name: 'Redness / rosacea',
    score: 5,
    severity: 'Moderate',
    areas: 'Central cheeks, nose',
    explanation: 'Persistent centrofacial erythema with visible vessels.',
    previous: 5,
  },
  {
    name: 'Under-eye area',
    score: 5,
    severity: 'Moderate',
    areas: 'Both tear troughs',
    explanation: 'Hollowing with mild pigment; volume loss likely.',
    previous: 6,
  },
  {
    name: 'Firmness / elasticity',
    score: 4,
    severity: 'Mild',
    areas: 'Jawline, mid-face',
    explanation: 'Early laxity along the jawline.',
    previous: 4,
  },
  {
    name: 'UV damage',
    score: 7,
    severity: 'Significant',
    areas: 'Forehead, cheeks, décolletage',
    explanation: 'Sub-surface damage well above the age-matched average.',
    previous: 8,
  },
  {
    name: 'Skin tone evenness',
    score: 5,
    severity: 'Moderate',
    areas: 'Full face',
    explanation: 'Uneven tone driven mostly by the pigment above.',
    previous: 6,
  },
];

export const SKIN_UNAVAILABLE = [
  'Acne / blemishes',
  'Moisture level',
  'Oiliness',
];

export const SKIN_RECOMMENDATIONS = [
  {
    service: 'Anti-Wrinkle Injections — Forehead',
    because: 'Wrinkles / fine lines 4/10',
    price: '€220',
  },
  {
    service: 'Laser Skin Rejuvenation',
    because: 'UV damage 7/10 · Pigmentation 6/10',
    price: '€350',
  },
  {
    service: 'Tear Trough Filler',
    because: 'Under-eye area 5/10',
    price: '€395',
  },
];

export const SKIN_PRODUCTS = [
  { name: 'Obagi Nu-Derm Clear', because: 'Pigmentation', price: '€96' },
  { name: 'SkinCeuticals C E Ferulic', because: 'UV damage', price: '€165' },
  { name: 'Heliocare 360° Gel SPF 50', because: 'UV damage', price: '€32' },
];
