/**
 * Booking enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Booking provider labels
export const bookingProviderLabels = {
  calendly: 'Calendly',
  timely: 'Timely',
  phorest: 'Phorest',
  fresha: 'Fresha',
} as const;

export const bookingProviderValues = Object.keys(bookingProviderLabels) as [
  keyof typeof bookingProviderLabels,
  ...(keyof typeof bookingProviderLabels)[],
];

export type BookingProvider = keyof typeof bookingProviderLabels;

/**
 * Amenities shown in the "Additional information" block of the public venue
 * page. Stored as a string[] on `organization.amenities`; the venue page maps
 * each key through these labels, and the dashboard renders the same list as
 * checkboxes. Adding a key here is the ONLY change needed to offer a new one.
 */
export const venueAmenityLabels = {
  instant_confirmation: 'Instant confirmation',
  pet_friendly: 'Pet-friendly',
  kid_friendly: 'Kid-friendly',
  lgbtq_friendly: 'LGBTQ+ friendly',
  wheelchair_accessible: 'Wheelchair accessible',
  parking_available: 'Parking available',
  free_wifi: 'Free Wi-Fi',
  card_payments: 'Card payments accepted',
} as const;

export const venueAmenityValues = Object.keys(venueAmenityLabels) as [
  keyof typeof venueAmenityLabels,
  ...(keyof typeof venueAmenityLabels)[],
];

export type VenueAmenity = keyof typeof venueAmenityLabels;
