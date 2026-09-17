/**
 * Organization enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Onboarding task labels
export const onboardingTaskLabels = {
  'create-first-post': 'Create your first post',
  'customise-booking-page': 'Customize your booking page',
  'link-booking-system': 'Link your booking system',
  'enable-lead-follow-up': 'Enable lead follow-up',
  'launch-first-ad': 'Launch your first ad',
} as const;

export const onboardingTaskValues = Object.keys(onboardingTaskLabels) as [
  keyof typeof onboardingTaskLabels,
  ...(keyof typeof onboardingTaskLabels)[],
];

export type OnboardingTask = keyof typeof onboardingTaskLabels;

// Primary calendar type labels
export const primaryCalendarTypeLabels = {
  borradh: 'Your Calendar',
  google_calendar: 'Google Calendar',
  calendly: 'Calendly',
  timely: 'Timely',
  phorest: 'Phorest',
  fresha: 'Fresha',
} as const;

export const primaryCalendarTypeValues = Object.keys(
  primaryCalendarTypeLabels
) as [
  keyof typeof primaryCalendarTypeLabels,
  ...(keyof typeof primaryCalendarTypeLabels)[],
];

export type PrimaryCalendarType = keyof typeof primaryCalendarTypeLabels;

/**
 * Where an organization takes its bookings.
 *
 * Replaces the `primaryCalendarType` + `primaryCalendarAccountId` pair, which
 * conflated "which calendar provider" with "where do customers book" and
 * described neither reliably — production had orgs marked `borradh` while
 * booking in Vagaro, and orgs with no calendar type whose booking link was a
 * Borradh page. No organization has ever had an external calendar account, so
 * the provider dimension it modelled was never used.
 *
 * This is the same two-way choice the booking settings UI has always
 * presented; it is now stored rather than derived.
 *
 * `borradh` also gates the operational surface — calendar, booking page,
 * sales, inventory — since none of it applies to a clinic whose diary lives in
 * another system. See ENG-500.
 */
export const bookingDestinationLabels = {
  borradh: 'Borradh booking system',
  external_link: 'External booking link',
} as const;

export const bookingDestinationValues = Object.keys(
  bookingDestinationLabels
) as [
  keyof typeof bookingDestinationLabels,
  ...(keyof typeof bookingDestinationLabels)[],
];

export type BookingDestination = keyof typeof bookingDestinationLabels;

// Business type labels
export const businessTypeLabels = {
  // Beauty & Hair
  hairdresser: 'Hairdresser',
  barber: 'Barber',
  salon: 'Salon',
  spa: 'Spa',
  nail_salon: 'Nail Salon',
  tattoo_studio: 'Tattoo Studio',
  // Clinics & Medical Aesthetics
  aesthetic_clinic: 'Aesthetic Clinic',
  cosmetic_clinic: 'Cosmetic Clinic',
  skin_clinic: 'Skin Clinic',
  dermatology_clinic: 'Dermatology Clinic',
  laser_clinic: 'Laser Hair Removal Clinic',
  fat_freezing_clinic: 'Fat Freezing Clinic',
  dental_practice: 'Dental Practice',
  medical_spa: 'Medical Spa',
  wellness_clinic: 'Wellness Clinic',
  physiotherapy: 'Physiotherapy',
  chiropractic: 'Chiropractic',
  beauty_clinic: 'Beauty Clinic',
  iv_therapy_clinic: 'IV Therapy Clinic',
  weight_loss_clinic: 'Weight Loss Clinic',
  anti_aging_clinic: 'Anti-Aging Clinic',
  hair_restoration: 'Hair Restoration Clinic',
  other: 'Other',
} as const;

export const businessTypeValues = Object.keys(businessTypeLabels) as [
  keyof typeof businessTypeLabels,
  ...(keyof typeof businessTypeLabels)[],
];

export type BusinessType = keyof typeof businessTypeLabels;

/**
 * Where the clinic sits geographically — drives the default ad-targeting
 * radius. A city/town clinic draws from a tight catchment (people won't travel
 * far when there's a clinic on every corner); a countryside/rural clinic draws
 * from a wide one (people expect to drive). Claire asks this once during the
 * first campaign and stores it on `org_defaults.ad_area_type`.
 */
export const clinicAreaTypeLabels = {
  city: 'City or town',
  countryside: 'Countryside or rural',
} as const;

export const clinicAreaTypeValues = Object.keys(clinicAreaTypeLabels) as [
  keyof typeof clinicAreaTypeLabels,
  ...(keyof typeof clinicAreaTypeLabels)[],
];

export type ClinicAreaType = keyof typeof clinicAreaTypeLabels;

// Content style template labels
export const contentStyleTemplateLabels = {
  clean_minimal: 'Clean & Minimal',
  bold_energetic: 'Bold & Energetic',
  elegant_professional: 'Elegant & Professional',
  playful_colorful: 'Playful & Colorful',
} as const;

export const contentStyleTemplateValues = Object.keys(
  contentStyleTemplateLabels
) as [
  keyof typeof contentStyleTemplateLabels,
  ...(keyof typeof contentStyleTemplateLabels)[],
];

export type ContentStyleTemplate = keyof typeof contentStyleTemplateLabels;

// Style preference labels — controls whether rendered graphics get the
// solid brand-color border ("basic") or are left edge-to-edge ("clean").
export const stylePreferenceLabels = {
  clean: 'Clean',
  basic: 'Basic',
} as const;

export const stylePreferenceValues = Object.keys(stylePreferenceLabels) as [
  keyof typeof stylePreferenceLabels,
  ...(keyof typeof stylePreferenceLabels)[],
];

export type StylePreference = keyof typeof stylePreferenceLabels;

// Outro style labels
export const outroStyleLabels = {
  offer: 'Offer',
  location: 'Location',
  tagline: 'Tagline',
} as const;

export const outroStyleValues = Object.keys(outroStyleLabels) as [
  keyof typeof outroStyleLabels,
  ...(keyof typeof outroStyleLabels)[],
];

export type OutroStyle = keyof typeof outroStyleLabels;

// Country code labels - SOURCE OF TRUTH
export const countryCodeLabels = {
  af: 'Afghanistan',
  al: 'Albania',
  dz: 'Algeria',
  ad: 'Andorra',
  ao: 'Angola',
  ag: 'Antigua and Barbuda',
  ar: 'Argentina',
  am: 'Armenia',
  au: 'Australia',
  at: 'Austria',
  az: 'Azerbaijan',
  bs: 'Bahamas',
  bh: 'Bahrain',
  bd: 'Bangladesh',
  bb: 'Barbados',
  by: 'Belarus',
  be: 'Belgium',
  bz: 'Belize',
  bj: 'Benin',
  bt: 'Bhutan',
  bo: 'Bolivia',
  ba: 'Bosnia and Herzegovina',
  bw: 'Botswana',
  br: 'Brazil',
  bn: 'Brunei',
  bg: 'Bulgaria',
  bf: 'Burkina Faso',
  bi: 'Burundi',
  cv: 'Cabo Verde',
  kh: 'Cambodia',
  cm: 'Cameroon',
  ca: 'Canada',
  cf: 'Central African Republic',
  td: 'Chad',
  cl: 'Chile',
  cn: 'China',
  co: 'Colombia',
  km: 'Comoros',
  cg: 'Congo (Congo-Brazzaville)',
  cr: 'Costa Rica',
  hr: 'Croatia',
  cu: 'Cuba',
  cy: 'Cyprus',
  cz: 'Czechia (Czech Republic)',
  cd: 'Democratic Republic of the Congo',
  dk: 'Denmark',
  dj: 'Djibouti',
  dm: 'Dominica',
  do: 'Dominican Republic',
  ec: 'Ecuador',
  eg: 'Egypt',
  sv: 'El Salvador',
  gq: 'Equatorial Guinea',
  er: 'Eritrea',
  ee: 'Estonia',
  sz: 'Eswatini (fmr. Swaziland)',
  et: 'Ethiopia',
  fj: 'Fiji',
  fi: 'Finland',
  fr: 'France',
  ga: 'Gabon',
  gm: 'Gambia',
  ge: 'Georgia',
  de: 'Germany',
  gh: 'Ghana',
  gr: 'Greece',
  gd: 'Grenada',
  gt: 'Guatemala',
  gn: 'Guinea',
  gw: 'Guinea-Bissau',
  gy: 'Guyana',
  ht: 'Haiti',
  hn: 'Honduras',
  hu: 'Hungary',
  is: 'Iceland',
  in: 'India',
  id: 'Indonesia',
  ir: 'Iran',
  iq: 'Iraq',
  ie: 'Ireland',
  il: 'Israel',
  it: 'Italy',
  jm: 'Jamaica',
  jp: 'Japan',
  jo: 'Jordan',
  kz: 'Kazakhstan',
  ke: 'Kenya',
  ki: 'Kiribati',
  kw: 'Kuwait',
  kg: 'Kyrgyzstan',
  la: 'Laos',
  lv: 'Latvia',
  lb: 'Lebanon',
  ls: 'Lesotho',
  lr: 'Liberia',
  ly: 'Libya',
  li: 'Liechtenstein',
  lt: 'Lithuania',
  lu: 'Luxembourg',
  mg: 'Madagascar',
  mw: 'Malawi',
  my: 'Malaysia',
  mv: 'Maldives',
  ml: 'Mali',
  mt: 'Malta',
  mh: 'Marshall Islands',
  mr: 'Mauritania',
  mu: 'Mauritius',
  mx: 'Mexico',
  fm: 'Micronesia',
  md: 'Moldova',
  mc: 'Monaco',
  mn: 'Mongolia',
  me: 'Montenegro',
  ma: 'Morocco',
  mz: 'Mozambique',
  mm: 'Myanmar (Burma)',
  na: 'Namibia',
  nr: 'Nauru',
  np: 'Nepal',
  nl: 'Netherlands',
  nz: 'New Zealand',
  ni: 'Nicaragua',
  ne: 'Niger',
  ng: 'Nigeria',
  kp: 'North Korea',
  mk: 'North Macedonia',
  no: 'Norway',
  om: 'Oman',
  pk: 'Pakistan',
  pw: 'Palau',
  pa: 'Panama',
  pg: 'Papua New Guinea',
  py: 'Paraguay',
  pe: 'Peru',
  ph: 'Philippines',
  pl: 'Poland',
  pt: 'Portugal',
  qa: 'Qatar',
  ro: 'Romania',
  ru: 'Russia',
  rw: 'Rwanda',
  kn: 'Saint Kitts and Nevis',
  lc: 'Saint Lucia',
  vc: 'Saint Vincent and the Grenadines',
  ws: 'Samoa',
  sm: 'San Marino',
  st: 'Sao Tome and Principe',
  sa: 'Saudi Arabia',
  sn: 'Senegal',
  rs: 'Serbia',
  sc: 'Seychelles',
  sl: 'Sierra Leone',
  sg: 'Singapore',
  sk: 'Slovakia',
  si: 'Slovenia',
  sb: 'Solomon Islands',
  so: 'Somalia',
  za: 'South Africa',
  kr: 'South Korea',
  ss: 'South Sudan',
  es: 'Spain',
  lk: 'Sri Lanka',
  sd: 'Sudan',
  sr: 'Suriname',
  se: 'Sweden',
  ch: 'Switzerland',
  sy: 'Syria',
  tw: 'Taiwan',
  tj: 'Tajikistan',
  tz: 'Tanzania',
  th: 'Thailand',
  tl: 'Timor-Leste',
  tg: 'Togo',
  to: 'Tonga',
  tt: 'Trinidad and Tobago',
  tn: 'Tunisia',
  tr: 'Turkey',
  tm: 'Turkmenistan',
  tv: 'Tuvalu',
  ug: 'Uganda',
  ua: 'Ukraine',
  ae: 'United Arab Emirates',
  gb: 'United Kingdom',
  us: 'United States',
  uy: 'Uruguay',
  uz: 'Uzbekistan',
  vu: 'Vanuatu',
  va: 'Vatican City',
  ve: 'Venezuela',
  vn: 'Vietnam',
  ye: 'Yemen',
  zm: 'Zambia',
  zw: 'Zimbabwe',
} as const;

export const countryCodeValues = Object.keys(countryCodeLabels) as [
  keyof typeof countryCodeLabels,
  ...(keyof typeof countryCodeLabels)[],
];

export type CountryCode = keyof typeof countryCodeLabels;

// =============================================================================
// TEAM-MEMBER PERMISSION LEVEL (Settings panel)
// =============================================================================
//
// The team-member editor's Settings panel exposes a Low/Medium/High permission
// level that maps onto the underlying `member.role` (`owner`/`admin`/`member`).
//
// ⚠️  `owner` is RESERVED for the org creator and is NEVER assignable through
// this UI — no team member can be granted destructive owner powers. Low maps to
// `member`; Medium and High both map to `admin` (High may later warrant a
// distinct elevated-admin role, but for now it also resolves to `admin`).
export const teamPermissionLevelLabels = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
} as const;

export const teamPermissionLevelValues = Object.keys(
  teamPermissionLevelLabels
) as [
  keyof typeof teamPermissionLevelLabels,
  ...(keyof typeof teamPermissionLevelLabels)[],
];

export type TeamPermissionLevel = keyof typeof teamPermissionLevelLabels;

/**
 * Assignable role produced by each permission level. `owner` is intentionally
 * absent from the codomain — it is reserved for the org creator and cannot be
 * assigned through the team-member editor.
 */
export const permissionLevelToRole = {
  low: 'member',
  medium: 'admin',
  high: 'admin',
} as const satisfies Record<TeamPermissionLevel, 'member' | 'admin'>;

/**
 * Reverse map for display only: given a stored `member.role`, which permission
 * level to surface in the editor. The forward map is lossy (both Medium and High
 * resolve to `admin`), so `admin` displays as `medium` by default. `owner` is
 * not an assignable level; for display it surfaces as `high` (the UI renders it
 * read-only, never offering it as a selectable option).
 */
export const roleToPermissionLevel = {
  member: 'low',
  admin: 'medium',
  owner: 'high',
} as const satisfies Record<'member' | 'admin' | 'owner', TeamPermissionLevel>;
