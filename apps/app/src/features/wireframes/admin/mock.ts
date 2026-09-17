/**
 * Fixtures for the reporting / search / settings / privacy wireframes.
 *
 * Numbers here are plausible for a two-room aesthetics clinic doing roughly
 * £40k a month, because a reviewer reads the shape of a report from the
 * magnitudes as much as from the layout — a revenue table full of £1.00 rows
 * reads as a broken page rather than a design.
 *
 * Nothing in here is fetched. Every page importing it is static.
 */

/* -------------------------------------------------------------------------- */
/* §18 Reporting                                                              */
/* -------------------------------------------------------------------------- */

export const DATE_PRESETS = [
  'Today',
  'Last 7 days',
  'Last 30 days',
  'This month',
  'Last month',
  'This quarter',
  'Custom range',
] as const;

export const COMPARISON_OPTIONS = [
  'No comparison',
  'Previous period',
  'Same period last year',
] as const;

export interface ReportTile {
  label: string;
  value: string;
  delta?: string;
  tone?: 'neutral' | 'good' | 'bad';
  sub?: string;
}

export const REVENUE_TILES: ReportTile[] = [
  {
    label: 'Total revenue',
    value: '£41,280',
    delta: '+12.4% vs previous 30 days',
    tone: 'good',
    sub: '318 transactions',
  },
  {
    label: 'Average transaction value',
    value: '£129.81',
    delta: '−£4.10 vs previous 30 days',
    tone: 'bad',
    sub: 'Pulled down by product-only sales',
  },
  {
    label: 'This month vs last',
    value: '£41,280 / £36,720',
    delta: '+£4,560',
    tone: 'good',
  },
  {
    label: 'This quarter vs last',
    value: '£118,940 / £109,300',
    delta: '+8.8%',
    tone: 'good',
  },
];

export interface RevenueRow {
  name: string;
  revenue: string;
  share: number;
  count: number;
}

export const REVENUE_BY_TREATMENT: RevenueRow[] = [
  {
    name: 'Anti-Wrinkle Injections — 3 Areas',
    revenue: '£11,760',
    share: 28,
    count: 49,
  },
  { name: 'Dermal Filler — Lips 1ml', revenue: '£8,910', share: 22, count: 33 },
  { name: 'Profhilo — Full Course', revenue: '£6,400', share: 16, count: 16 },
  { name: 'Skin Booster — Face', revenue: '£4,275', share: 10, count: 19 },
  {
    name: 'Chemical Peel — Medium Depth',
    revenue: '£3,120',
    share: 8,
    count: 26,
  },
  { name: 'Microneedling with PRP', revenue: '£2,850', share: 7, count: 15 },
  { name: 'Consultation — Aesthetic', revenue: '£1,240', share: 3, count: 31 },
  { name: 'Skincare & retail', revenue: '£2,725', share: 6, count: 88 },
];

export const REVENUE_BY_PRACTITIONER: RevenueRow[] = [
  { name: 'Dr Aoife Brennan', revenue: '£18,640', share: 45, count: 121 },
  { name: 'Nurse Rachel Okafor', revenue: '£13,010', share: 32, count: 104 },
  { name: 'Nurse Priya Anand', revenue: '£7,905', share: 19, count: 71 },
  {
    name: 'Leah Mitchell (Aesthetician)',
    revenue: '£1,725',
    share: 4,
    count: 22,
  },
];

export interface PaymentTypeRow {
  name: string;
  revenue: string;
  share: number;
  /** True where the amount is also counted inside another row on this table. */
  doubleCounted?: boolean;
}

export const REVENUE_BY_PAYMENT_TYPE: PaymentTypeRow[] = [
  { name: 'Individual treatment', revenue: '£26,410', share: 64 },
  { name: 'Membership charge', revenue: '£7,200', share: 17 },
  { name: 'Package redemption', revenue: '£4,945', share: 12 },
  { name: 'Product / retail', revenue: '£2,725', share: 7 },
  { name: 'Deposits taken', revenue: '£3,150', share: 8, doubleCounted: true },
];

export const CLIENT_TILES: ReportTile[] = [
  {
    label: 'New clients',
    value: '47',
    delta: '+9 vs previous 30 days',
    tone: 'good',
  },
  {
    label: 'Retention rate',
    value: '68%',
    delta: '−3 pts vs previous 30 days',
    tone: 'bad',
    sub: 'Returned within 16 weeks',
  },
  {
    label: 'Average visits per client',
    value: '3.4',
    sub: 'Rolling 12 months',
  },
  {
    label: 'Average revenue per client',
    value: '£412',
    sub: 'Rolling 12 months',
  },
];

export const NEW_CLIENTS_BY_SOURCE: RevenueRow[] = [
  { name: 'Meta ads — lead form', revenue: '19 clients', share: 40, count: 19 },
  { name: 'Instagram profile', revenue: '11 clients', share: 23, count: 11 },
  { name: 'Word of mouth', revenue: '8 clients', share: 17, count: 8 },
  { name: 'Google search', revenue: '6 clients', share: 13, count: 6 },
  { name: 'Walk-in', revenue: '3 clients', share: 7, count: 3 },
];

/**
 * Cohort retention. `cells` is "% of that month's intake still active" at
 * month 0..5; `null` means the cohort is not old enough to have that column.
 */
export interface CohortRow {
  cohort: string;
  size: number;
  cells: (number | null)[];
}

export const COHORT_MONTHS = ['M0', 'M1', 'M2', 'M3', 'M4', 'M5'];

export const COHORTS: CohortRow[] = [
  { cohort: 'Mar 2026', size: 38, cells: [100, 71, 58, 47, 42, 39] },
  { cohort: 'Apr 2026', size: 44, cells: [100, 75, 61, 52, 45, null] },
  { cohort: 'May 2026', size: 41, cells: [100, 68, 54, 44, null, null] },
  { cohort: 'Jun 2026', size: 52, cells: [100, 79, 66, null, null, null] },
  { cohort: 'Jul 2026', size: 49, cells: [100, 73, null, null, null, null] },
  { cohort: 'Aug 2026', size: 47, cells: [100, null, null, null, null, null] },
];

export interface TopClient {
  name: string;
  spend: string;
  visits: number;
  lastVisit: string;
  membership: string;
}

export const TOP_CLIENTS: TopClient[] = [
  {
    name: 'Siobhán Doyle',
    spend: '£4,180',
    visits: 14,
    lastVisit: '18 Aug 2026',
    membership: 'Platinum',
  },
  {
    name: 'Hannah Wright',
    spend: '£3,640',
    visits: 11,
    lastVisit: '27 Aug 2026',
    membership: 'Platinum',
  },
  {
    name: 'Marta Kowalczyk',
    spend: '£3,105',
    visits: 12,
    lastVisit: '05 Aug 2026',
    membership: 'Gold',
  },
  {
    name: 'Chloe Ferguson',
    spend: '£2,880',
    visits: 9,
    lastVisit: '22 Aug 2026',
    membership: 'Gold',
  },
  {
    name: 'Nadia Hussain',
    spend: '£2,545',
    visits: 10,
    lastVisit: '30 Jul 2026',
    membership: 'None',
  },
  {
    name: 'Emily Sanderson',
    spend: '£2,410',
    visits: 8,
    lastVisit: '29 Aug 2026',
    membership: 'Gold',
  },
  {
    name: 'Grace O’Sullivan',
    spend: '£2,290',
    visits: 7,
    lastVisit: '12 Aug 2026',
    membership: 'None',
  },
  {
    name: 'Bethan Price',
    spend: '£2,150',
    visits: 9,
    lastVisit: '02 Aug 2026',
    membership: 'Silver',
  },
  {
    name: 'Amara Nwosu',
    spend: '£1,995',
    visits: 6,
    lastVisit: '25 Aug 2026',
    membership: 'None',
  },
  {
    name: 'Katie Rowland',
    spend: '£1,860',
    visits: 8,
    lastVisit: '19 Aug 2026',
    membership: 'Silver',
  },
];

export interface TreatmentPerformanceRow {
  name: string;
  performed: number;
  revenue: string;
  rebookingRate: number;
  noShowRate: number;
}

export const TREATMENT_PERFORMANCE: TreatmentPerformanceRow[] = [
  {
    name: 'Anti-Wrinkle Injections — 3 Areas',
    performed: 49,
    revenue: '£11,760',
    rebookingRate: 74,
    noShowRate: 4,
  },
  {
    name: 'Dermal Filler — Lips 1ml',
    performed: 33,
    revenue: '£8,910',
    rebookingRate: 61,
    noShowRate: 6,
  },
  {
    name: 'Profhilo — Full Course',
    performed: 16,
    revenue: '£6,400',
    rebookingRate: 81,
    noShowRate: 2,
  },
  {
    name: 'Skin Booster — Face',
    performed: 19,
    revenue: '£4,275',
    rebookingRate: 52,
    noShowRate: 11,
  },
  {
    name: 'Chemical Peel — Medium Depth',
    performed: 26,
    revenue: '£3,120',
    rebookingRate: 44,
    noShowRate: 15,
  },
  {
    name: 'Microneedling with PRP',
    performed: 15,
    revenue: '£2,850',
    rebookingRate: 58,
    noShowRate: 9,
  },
  {
    name: 'Consultation — Aesthetic',
    performed: 31,
    revenue: '£1,240',
    rebookingRate: 39,
    noShowRate: 22,
  },
];

export const MARKETING_TILES: ReportTile[] = [
  {
    label: 'Ad spend',
    value: '£3,420',
    delta: '+£610 vs previous 30 days',
    tone: 'neutral',
    sub: 'Meta — 3 active campaigns',
  },
  {
    label: 'Cost per lead',
    value: '£17.44',
    delta: '−£2.06 vs previous 30 days',
    tone: 'good',
    sub: '196 leads',
  },
  {
    label: 'Cost per new patient',
    value: '£72.77',
    delta: '+£5.30 vs previous 30 days',
    tone: 'bad',
    sub: '47 new patients',
  },
  {
    label: 'Return on ad spend',
    value: '5.7×',
    delta: '£19,364 from new patients',
    tone: 'good',
    sub: 'First-visit revenue only',
  },
];

export interface FunnelStage {
  label: string;
  value: number;
  caption: string;
}

export const MARKETING_FUNNEL: FunnelStage[] = [
  { label: 'Impressions', value: 184_200, caption: '£18.57 CPM' },
  { label: 'Link clicks', value: 4_610, caption: '2.5% CTR' },
  { label: 'Leads', value: 196, caption: '4.3% of clicks · £17.44 CPL' },
  { label: 'Booked', value: 63, caption: '32% of leads' },
  { label: 'Attended (new patient)', value: 47, caption: '75% of bookings' },
];

export interface CampaignRoiRow {
  name: string;
  spend: string;
  leads: number;
  cpl: string;
  newPatients: number;
  costPerPatient: string;
  revenue: string;
  roas: string;
}

export const CAMPAIGN_ROI: CampaignRoiRow[] = [
  {
    name: 'Anti-Wrinkle — Autumn offer',
    spend: '£1,640',
    leads: 98,
    cpl: '£16.73',
    newPatients: 26,
    costPerPatient: '£63.08',
    revenue: '£11,180',
    roas: '6.8×',
  },
  {
    name: 'Lip Filler — Retargeting',
    spend: '£980',
    leads: 61,
    cpl: '£16.07',
    newPatients: 14,
    costPerPatient: '£70.00',
    revenue: '£5,320',
    roas: '5.4×',
  },
  {
    name: 'Profhilo — Consultation lead form',
    spend: '£800',
    leads: 37,
    cpl: '£21.62',
    newPatients: 7,
    costPerPatient: '£114.29',
    revenue: '£2,864',
    roas: '3.6×',
  },
];

/* -------------------------------------------------------------------------- */
/* §20 Search                                                                 */
/* -------------------------------------------------------------------------- */

export interface SearchClientResult {
  name: string;
  /** Near-duplicate names are the norm; the secondary line disambiguates. */
  secondary: string;
  tags: string[];
}

export const SEARCH_CLIENTS: SearchClientResult[] = [
  {
    name: 'Sarah Murphy',
    secondary: '07700 900142 · sarah.murphy@gmail.com · last visit 18 Aug 2026',
    tags: ['Platinum'],
  },
  {
    name: 'Sarah Murphy',
    secondary: '07700 900318 · s.murphy91@outlook.com · last visit 04 Mar 2026',
    tags: ['Lapsed'],
  },
  {
    name: 'Sarah Murray',
    secondary: '07700 900774 · sarahmurray@icloud.com · new, no visits yet',
    tags: ['Meta lead'],
  },
  {
    name: 'Sara Mahmood',
    secondary: '07700 900506 · sara.m@yahoo.co.uk · last visit 29 Aug 2026',
    tags: ['Gold', 'Allergy: lidocaine'],
  },
  {
    name: 'Sarah-Jane Okonkwo',
    secondary: '07700 900233 · sjokonkwo@gmail.com · last visit 11 Jul 2026',
    tags: [],
  },
];

export const SEARCH_CLIENT_TOTAL = 23;

export interface SearchBookingResult {
  title: string;
  secondary: string;
  status: string;
}

export const SEARCH_BOOKINGS: SearchBookingResult[] = [
  {
    title: 'Sarah Murphy — Anti-Wrinkle Injections, 3 Areas',
    secondary: 'Tue 2 Sep 2026, 10:30 · Dr Aoife Brennan · Room 1',
    status: 'Confirmed',
  },
  {
    title: 'Sarah Murphy — Dermal Filler, Lips 1ml',
    secondary: 'Thu 18 Sep 2026, 15:00 · Nurse Rachel Okafor · Room 2',
    status: 'Deposit due',
  },
  {
    title: 'Sara Mahmood — Profhilo, session 2 of 2',
    secondary: 'Fri 5 Sep 2026, 09:15 · Dr Aoife Brennan · Room 1',
    status: 'Confirmed',
  },
];

export const SEARCH_BOOKING_TOTAL = 8;

export interface SearchTreatmentResult {
  name: string;
  secondary: string;
}

export const SEARCH_TREATMENTS: SearchTreatmentResult[] = [
  {
    name: 'Anti-Wrinkle Injections — 3 Areas',
    secondary: '45 min · £240 · deposit £50 · 3 practitioners',
  },
  {
    name: 'Anti-Wrinkle Injections — 1 Area',
    secondary: '30 min · £160 · deposit £50 · 3 practitioners',
  },
];

export const SEARCH_TREATMENT_TOTAL = 4;

export const SEARCH_RECENT = [
  { name: 'Hannah Wright', secondary: 'Client · viewed 8 minutes ago' },
  {
    name: 'Marta Kowalczyk — Skin Booster',
    secondary: 'Booking · Mon 1 Sep, 14:00',
  },
  { name: 'Chemical Peel — Medium Depth', secondary: 'Treatment · £120' },
  { name: 'Emily Sanderson', secondary: 'Client · viewed yesterday' },
];

export const SEARCH_QUICK_ACTIONS = [
  'New booking',
  'Walk-in',
  'Add to waitlist',
  "Today's schedule",
];

/* §20.2 advanced client filters */

export const FILTER_TAGS = [
  'Platinum',
  'Gold',
  'Silver',
  'Lapsed',
  'VIP',
  'Allergy: lidocaine',
  'Do not photograph',
];

export const FILTER_TREATMENTS = [
  'Anti-Wrinkle Injections — 3 Areas',
  'Dermal Filler — Lips 1ml',
  'Profhilo — Full Course',
  'Skin Booster — Face',
  'Chemical Peel — Medium Depth',
];

export const FILTER_SOURCES = [
  'Meta ads — lead form',
  'Instagram profile',
  'Google search',
  'Word of mouth',
  'Walk-in',
  'Referral',
];

export const FILTER_MEMBERSHIPS = [
  'Any',
  'Active member',
  'Lapsed member',
  'Never a member',
];

export interface FilteredClientRow {
  id: string;
  name: string;
  phone: string;
  lastVisit: string;
  totalSpend: string;
  source: string;
  membership: string;
  tags: string[];
}

export const FILTERED_CLIENTS: FilteredClientRow[] = [
  {
    id: 'cl-1',
    name: 'Siobhán Doyle',
    phone: '07700 900411',
    lastVisit: '18 Aug 2026',
    totalSpend: '£4,180',
    source: 'Word of mouth',
    membership: 'Platinum',
    tags: ['Platinum', 'VIP'],
  },
  {
    id: 'cl-2',
    name: 'Hannah Wright',
    phone: '07700 900987',
    lastVisit: '27 Aug 2026',
    totalSpend: '£3,640',
    source: 'Meta ads — lead form',
    membership: 'Platinum',
    tags: ['Platinum'],
  },
  {
    id: 'cl-3',
    name: 'Marta Kowalczyk',
    phone: '07700 900255',
    lastVisit: '05 Aug 2026',
    totalSpend: '£3,105',
    source: 'Instagram profile',
    membership: 'Gold',
    tags: ['Gold'],
  },
  {
    id: 'cl-4',
    name: 'Chloe Ferguson',
    phone: '07700 900604',
    lastVisit: '22 Aug 2026',
    totalSpend: '£2,880',
    source: 'Meta ads — lead form',
    membership: 'Gold',
    tags: ['Gold'],
  },
  {
    id: 'cl-5',
    name: 'Emily Sanderson',
    phone: '07700 900139',
    lastVisit: '29 Aug 2026',
    totalSpend: '£2,410',
    source: 'Google search',
    membership: 'Gold',
    tags: ['Gold', 'Allergy: lidocaine'],
  },
];

/* -------------------------------------------------------------------------- */
/* §5 Settings                                                                */
/* -------------------------------------------------------------------------- */

export interface SettingsNavItem {
  id: string;
  label: string;
  blurb: string;
  state: 'built' | 'partial' | 'missing';
}

export const SETTINGS_NAV: SettingsNavItem[] = [
  {
    id: 'business-profile',
    label: 'Business profile',
    blurb: 'Name, logo, address, contact, time zone, currency.',
    state: 'built',
  },
  {
    id: 'trading-hours',
    label: 'Trading hours',
    blurb: 'Seven-row grid plus holiday closures. Its own save semantics.',
    state: 'built',
  },
  {
    id: 'service-menu',
    label: 'Service menu',
    blurb: 'Treatments, prices, deposits — plus three missing care fields.',
    state: 'partial',
  },
  {
    id: 'practitioners',
    label: 'Practitioners',
    blurb: 'Roles, services, working hours, booking-page bio.',
    state: 'partial',
  },
  {
    id: 'products',
    label: 'Products',
    blurb:
      'Feeds the face-mapping pin tool. Type, unit and lot tracking missing.',
    state: 'partial',
  },
  {
    id: 'booking-page',
    label: 'Booking page',
    blurb: 'URL, theme, welcome message, policies, buffer and max advance.',
    state: 'partial',
  },
  {
    id: 'deposits',
    label: 'Deposits & policies',
    blurb: 'Deposit amounts, cancellation window, no-show charges.',
    state: 'built',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    blurb: 'Event × channel matrix, recipients, digests.',
    state: 'partial',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    blurb: 'Stripe, WhatsApp, Google Business Profile, calendar sync.',
    state: 'partial',
  },
  {
    id: 'data-privacy',
    label: 'Data & privacy',
    blurb: 'Clinic export and GDPR patient deletion.',
    state: 'missing',
  },
];

export const SERVICE_CATEGORIES = [
  'Injectables',
  'Skin treatments',
  'Laser',
  'Consultation',
  'Retail',
];

export const CONSENT_TEMPLATES = [
  'Injectable consent (Botox, fillers)',
  'Laser / IPL consent',
  'Chemical peel consent',
  'General aesthetic treatment consent',
  'Medical history questionnaire',
  'Photo consent — clinical records',
  'Photo consent — marketing use',
];

export const PRACTITIONERS = [
  { id: 'p-1', name: 'Dr Aoife Brennan', role: 'Doctor' },
  { id: 'p-2', name: 'Nurse Rachel Okafor', role: 'Aesthetic Nurse' },
  { id: 'p-3', name: 'Nurse Priya Anand', role: 'Aesthetic Nurse' },
  { id: 'p-4', name: 'Leah Mitchell', role: 'Aesthetician' },
  { id: 'p-5', name: 'Tom Geraghty', role: 'Receptionist' },
];

export const BOOKING_THEMES = [
  { id: 'stone', label: 'Stone', swatch: 'bg-stone-500' },
  { id: 'rose', label: 'Rose', swatch: 'bg-rose-500' },
  { id: 'teal', label: 'Teal', swatch: 'bg-teal-600' },
  { id: 'indigo', label: 'Indigo', swatch: 'bg-indigo-500' },
  { id: 'amber', label: 'Amber', swatch: 'bg-amber-500' },
];

/* §5.4 products */

export const PRODUCT_TYPES = [
  'Injectable — Toxin',
  'Injectable — Filler',
  'Laser',
  'Peel',
  'Skincare',
  'Other',
] as const;

export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_UNITS = ['units', 'ml', 'mg'] as const;

export type ProductUnit = (typeof PRODUCT_UNITS)[number];

export interface ProductRow {
  id: string;
  name: string;
  type: ProductType;
  unit: ProductUnit;
  supplier: string;
  lotTracking: boolean;
}

export const PRODUCTS: ProductRow[] = [
  {
    id: 'pr-1',
    name: 'Botox (Allergan)',
    type: 'Injectable — Toxin',
    unit: 'units',
    supplier: 'Church Pharmacy',
    lotTracking: true,
  },
  {
    id: 'pr-2',
    name: 'Azzalure',
    type: 'Injectable — Toxin',
    unit: 'units',
    supplier: 'Wigmore Medical',
    lotTracking: true,
  },
  {
    id: 'pr-3',
    name: 'Juvéderm Voluma',
    type: 'Injectable — Filler',
    unit: 'ml',
    supplier: 'Church Pharmacy',
    lotTracking: true,
  },
  {
    id: 'pr-4',
    name: 'Teoxane RHA 3',
    type: 'Injectable — Filler',
    unit: 'ml',
    supplier: 'Teoxane UK',
    lotTracking: true,
  },
  {
    id: 'pr-5',
    name: 'Profhilo',
    type: 'Injectable — Filler',
    unit: 'ml',
    supplier: 'HA-Derma',
    lotTracking: true,
  },
  {
    id: 'pr-6',
    name: 'ZO Skin Health 3-Step Peel',
    type: 'Peel',
    unit: 'ml',
    supplier: 'ZO Skin Health',
    lotTracking: false,
  },
  {
    id: 'pr-7',
    name: 'Obagi Nu-Derm Clear',
    type: 'Skincare',
    unit: 'ml',
    supplier: 'Healthxchange',
    lotTracking: false,
  },
  {
    id: 'pr-8',
    name: 'Lynton Excelight IPL consumable',
    type: 'Laser',
    unit: 'units',
    supplier: 'Lynton Lasers',
    lotTracking: false,
  },
];

/* -------------------------------------------------------------------------- */
/* §21 Data export and GDPR                                                   */
/* -------------------------------------------------------------------------- */

export interface ExportDataset {
  id: string;
  label: string;
  format: string;
  detail: string;
  size: string;
}

export const EXPORT_DATASETS: ExportDataset[] = [
  {
    id: 'clients',
    label: 'Client records',
    format: 'CSV',
    detail: 'All fields, plus a treatment history summary per client.',
    size: '1.2 MB',
  },
  {
    id: 'treatments',
    label: 'Treatment history',
    format: 'CSV',
    detail: 'Every visit: date, treatment, practitioner, products used, cost.',
    size: '4.8 MB',
  },
  {
    id: 'photos',
    label: 'Before / after photos',
    format: 'ZIP',
    detail: 'Organised by patient name and date.',
    size: '6.4 GB',
  },
  {
    id: 'consent',
    label: 'Consent forms',
    format: 'ZIP of PDFs',
    detail: 'Signed forms with signature and timestamp.',
    size: '318 MB',
  },
  {
    id: 'financial',
    label: 'Financial data',
    format: 'CSV',
    detail: 'Payments, deposits, membership charges, refunds.',
    size: '2.1 MB',
  },
  {
    id: 'bookings',
    label: 'Booking history',
    format: 'CSV',
    detail: 'Every booking including cancellations and no-shows.',
    size: '3.3 MB',
  },
];

export type ExportStatus = 'queued' | 'preparing' | 'ready' | 'expired';

export interface ExportHistoryRow {
  id: string;
  requestedAt: string;
  requestedBy: string;
  datasets: string;
  size: string;
  status: ExportStatus;
  statusDetail: string;
}

export const EXPORT_HISTORY: ExportHistoryRow[] = [
  {
    id: 'ex-1',
    requestedAt: '1 Sep 2026, 09:12',
    requestedBy: 'Dr Aoife Brennan (Owner)',
    datasets: 'Photos, Consent forms',
    size: 'Estimating…',
    status: 'preparing',
    statusDetail: 'Packaging 6.7 GB — around 25 minutes left',
  },
  {
    id: 'ex-2',
    requestedAt: '1 Sep 2026, 09:10',
    requestedBy: 'Dr Aoife Brennan (Owner)',
    datasets: 'Financial data',
    size: '—',
    status: 'queued',
    statusDetail: 'Waiting — one export runs at a time',
  },
  {
    id: 'ex-3',
    requestedAt: '24 Aug 2026, 16:40',
    requestedBy: 'Dr Aoife Brennan (Owner)',
    datasets: 'Client records, Treatment history, Booking history',
    size: '9.3 MB',
    status: 'ready',
    statusDetail: 'Link expires 31 Aug 2026',
  },
  {
    id: 'ex-4',
    requestedAt: '02 Jul 2026, 11:05',
    requestedBy: 'Tom Geraghty (Reception)',
    datasets: 'Client records',
    size: '1.1 MB',
    status: 'expired',
    statusDetail: 'Link expired 09 Jul 2026 — request again to regenerate',
  },
];

export interface GdprPatient {
  id: string;
  name: string;
  secondary: string;
  /** Blocks deletion until cleared. Empty = deletable. */
  blockers: string[];
}

export const GDPR_PATIENTS: GdprPatient[] = [
  {
    id: 'g-1',
    name: 'Nadia Hussain',
    secondary:
      '07700 900506 · 10 visits · joined Nov 2024 · last visit 30 Jul 2026',
    blockers: [],
  },
  {
    id: 'g-2',
    name: 'Bethan Price',
    secondary:
      '07700 900873 · 9 visits · joined Feb 2025 · last visit 02 Aug 2026',
    blockers: ['Outstanding balance of £85.00 on invoice INV-2094'],
  },
  {
    id: 'g-3',
    name: 'Amara Nwosu',
    secondary:
      '07700 900311 · 6 visits · joined Jan 2026 · last visit 25 Aug 2026',
    blockers: [
      'Future booking: Skin Booster — Face, Thu 11 Sep 2026, 11:00 with Nurse Priya Anand',
    ],
  },
];

export const GDPR_ERASED = [
  'Name, date of birth, address, phone number and email',
  'Clinical photographs and before/after comparisons',
  'Consultation notes and face-map annotations',
  'Marketing consent, message history and campaign attribution',
  'Portal login and saved card details',
];

export const GDPR_RETAINED = [
  {
    label: 'Financial records — 6 years',
    detail:
      'Invoices, payments and refunds are kept for HMRC/Revenue, with the patient replaced by an anonymous reference (Patient #4471).',
  },
  {
    label: 'Medical treatment records — 8 years (adults)',
    detail:
      'Product, lot number, dose and injection site are retained under professional indemnity and medicines-traceability duties, unlinked from identifying data.',
  },
  {
    label: 'Signed consent forms — for the retention life of the record',
    detail:
      'Kept as evidence that consent was obtained, with the signature image redacted.',
  },
];

/* -------------------------------------------------------------------------- */
/* §17 Consent expiry and kiosk                                               */
/* -------------------------------------------------------------------------- */

export type ConsentState = 'expired' | 'expiring' | 'due-soon';

export interface ReconsentRow {
  id: string;
  patient: string;
  patientSecondary: string;
  form: string;
  signed: string;
  /** Negative = already expired. */
  daysUntilExpiry: number;
  nextBooking: string | null;
  state: ConsentState;
}

export const RECONSENT_QUEUE: ReconsentRow[] = [
  {
    id: 'rc-1',
    patient: 'Katie Rowland',
    patientSecondary: '07700 900620 · Gold',
    form: 'Medical history questionnaire',
    signed: '14 Aug 2025',
    daysUntilExpiry: -18,
    nextBooking: 'Wed 3 Sep 2026, 10:00 — Anti-Wrinkle Injections',
    state: 'expired',
  },
  {
    id: 'rc-2',
    patient: 'Grace O’Sullivan',
    patientSecondary: '07700 900744 · no membership',
    form: 'Injectable consent (Botox, fillers)',
    signed: '02 Sep 2025',
    daysUntilExpiry: 1,
    nextBooking: 'Thu 4 Sep 2026, 16:30 — Dermal Filler, Lips 1ml',
    state: 'expiring',
  },
  {
    id: 'rc-3',
    patient: 'Chloe Ferguson',
    patientSecondary: '07700 900604 · Gold',
    form: 'Medical history questionnaire',
    signed: '20 Sep 2025',
    daysUntilExpiry: 19,
    nextBooking: 'Mon 22 Sep 2026, 09:30 — Profhilo, session 1',
    state: 'expiring',
  },
  {
    id: 'rc-4',
    patient: 'Marta Kowalczyk',
    patientSecondary: '07700 900255 · Gold',
    form: 'Chemical peel consent',
    signed: '11 Oct 2025',
    daysUntilExpiry: 40,
    nextBooking: null,
    state: 'due-soon',
  },
  {
    id: 'rc-5',
    patient: 'Emily Sanderson',
    patientSecondary: '07700 900139 · Gold · allergy: lidocaine',
    form: 'Injectable consent (Botox, fillers)',
    signed: '28 Oct 2025',
    daysUntilExpiry: 57,
    nextBooking: 'Fri 12 Sep 2026, 14:00 — Anti-Wrinkle Injections',
    state: 'due-soon',
  },
];

export interface KioskQuestion {
  id: string;
  label: string;
  kind: 'yes-no' | 'text';
  /** Shown only when the parent answer is "Yes". */
  followUp?: string;
}

export interface KioskSection {
  id: string;
  title: string;
  intro?: string;
  questions?: KioskQuestion[];
  /** Long legal text that must be scrolled to the end before accepting. */
  legal?: string;
  signature?: boolean;
}

export const KIOSK_SECTIONS: KioskSection[] = [
  {
    id: 'k-1',
    title: 'Your medical history',
    intro:
      'Please answer honestly. Some conditions change what we can safely treat today.',
    questions: [
      {
        id: 'q-1',
        label: 'Are you pregnant or breastfeeding?',
        kind: 'yes-no',
      },
      {
        id: 'q-2',
        label: 'Do you have any allergies?',
        kind: 'yes-no',
        followUp: 'Which allergies, and what happens?',
      },
      {
        id: 'q-3',
        label: 'Are you taking any regular medication?',
        kind: 'yes-no',
        followUp: 'Please list the medication and dose.',
      },
      {
        id: 'q-4',
        label:
          'Have you had a cosmetic injectable treatment in the last 4 weeks?',
        kind: 'yes-no',
        followUp: 'What was it, and where was it done?',
      },
    ],
  },
  {
    id: 'k-2',
    title: 'Risks and side effects',
    legal:
      'Botulinum toxin and dermal filler treatments carry recognised risks including bruising, swelling, tenderness, asymmetry, headache, infection and, rarely, vascular occlusion which can cause skin necrosis or visual disturbance. Results are temporary and vary between individuals. Touch-up treatment may be required and may be charged separately. You must tell the practitioner immediately if you experience unusual pain, blanching of the skin, or any change in vision following treatment.',
  },
  {
    id: 'k-3',
    title: 'Photography consent',
    intro:
      'Clinical photographs are part of your record. Marketing use is entirely separate and optional.',
    questions: [
      {
        id: 'q-5',
        label: 'I consent to clinical photographs being stored in my record.',
        kind: 'yes-no',
      },
      {
        id: 'q-6',
        label: 'I consent to my photographs being used in clinic marketing.',
        kind: 'yes-no',
      },
    ],
  },
  {
    id: 'k-4',
    title: 'Sign to confirm',
    intro:
      'By signing you confirm the answers above are accurate to the best of your knowledge.',
    signature: true,
  },
];
