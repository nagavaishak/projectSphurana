export const BusinessTypeEnumValues: Record<string, string> = {
  hairdresser: 'Hairdresser',
  barber: 'Barber',
  salon: 'Salon',
  spa: 'Spa',
  nail_salon: 'Nail Salon',
  tattoo_studio: 'Tattoo Studio',
  other: 'Other',
};

export const BusinessTypeKeys = Object.keys(BusinessTypeEnumValues) as [
  string,
  ...string[],
];
export type BusinessType = (typeof BusinessTypeKeys)[number];

// Common countries - add more as needed
export const countryCodeEnumValues: Record<string, string> = {
  us: 'United States',
  gb: 'United Kingdom',
  ca: 'Canada',
  au: 'Australia',
  de: 'Germany',
  fr: 'France',
  es: 'Spain',
  it: 'Italy',
  nl: 'Netherlands',
  br: 'Brazil',
  mx: 'Mexico',
  jp: 'Japan',
  kr: 'South Korea',
  in: 'India',
  sg: 'Singapore',
  ae: 'United Arab Emirates',
  za: 'South Africa',
  nz: 'New Zealand',
  ie: 'Ireland',
  pt: 'Portugal',
  se: 'Sweden',
  no: 'Norway',
  dk: 'Denmark',
  fi: 'Finland',
  ch: 'Switzerland',
  at: 'Austria',
  be: 'Belgium',
  pl: 'Poland',
  other: 'Other',
};

export type CountryCode = keyof typeof countryCodeEnumValues;
export const countryCodeKeys = Object.keys(countryCodeEnumValues) as [
  string,
  ...string[],
];
