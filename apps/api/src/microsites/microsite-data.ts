import type {
  MicrositeAsset,
  MicrositeData,
  MicrositeLocation,
  MicrositeOpeningHoursDay,
  MicrositePractitioner,
  MicrositeService,
} from '@borradh-workspace/web-shared';

// One declaration of the wire format, in the contract package. This file
// used to declare its own copy while the Astro app declared another; see
// the note in web-shared/src/microsites/data.ts.
export type {
  MicrositeAsset,
  MicrositeData,
  MicrositeLocation,
  MicrositeOpeningHoursDay,
  MicrositeOpeningHoursException,
  MicrositePractitioner,
  MicrositeService,
} from '@borradh-workspace/web-shared';
import type { VenueConfig } from '@borradh-workspace/features/venue';
import { formatServicePrice } from '@borradh-workspace/labels';

/**
 * THE WIRE SHAPE of `data` on the document response — the renderer's
 * `MicrositeData` (apps/marketing-astro/src/components/microsite/data.ts),
 * declared here rather than imported.
 *
 * `apps/api` does not depend on the Astro app, and these types are NOT in
 * `@borradh-workspace/web-shared` — that package owns the DOCUMENT contract
 * (blocks, theme, pages), which is a jsonb shape shared with the database.
 * This is a response projection, which is a different thing with a different
 * lifetime. Kept side by side deliberately; if it drifts, the renderer reads
 * `undefined` and a section silently disappears from a live tenant page, so
 * they belong in web-shared the moment either side needs to change.
 */

/**
 * VenueConfig → `MicrositeData`, the VIEW-SHAPED bundle the Astro renderer is
 * handed (apps/marketing-astro/src/components/microsite/data.ts).
 *
 * This is presentation mapping, not business logic: no query runs here. The
 * read is `getVenueConfig` — plan §5 says extend that rather than compose the
 * internal list services, because both public endpoints already bypass them and
 * a third read path would be one too many.
 *
 * Two rules the renderer depends on and cannot enforce itself:
 *
 *   1. PRICES ARE PRE-FORMATTED, by `formatServicePrice()` and nothing else.
 *      `priceText` is the retiring freeform column; quoting it would make the
 *      website disagree with the booking widget on the same screen.
 *   2. HOURS ARRIVE AS LABEL STRINGS. The renderer ships no JS and no
 *      date library, so minute offsets would have to be formatted client-side.
 *
 * Known gaps against the contract, all of them `getVenueConfig`'s shape rather
 * than decisions taken here (plan §5 lists the same three):
 *   - ONE location. A multi-branch org renders its primary venue only.
 *   - No opening-hours EXCEPTIONS in any public payload.
 *   - No per-photo intrinsic dimensions — `width`/`height` are omitted, so the
 *     renderer cannot reserve space and gallery images can cost CLS.
 */

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

/** Minutes-from-midnight → "09:00". 24h, locale-independent by design. */
const clockLabel = (minutes: number): string => {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

/** 45 → "45 min", 60 → "1 hr", 90 → "1 hr 30 min". */
const durationLabel = (minutes: number | null): string | undefined => {
  if (!minutes || minutes <= 0) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} hr ${m} min` : `${h} hr`;
};

/**
 * Monday-first week. The stored map is 0=Sun..6=Sat; a business week that reads
 * Sunday-first looks wrong on a European salon's site and right on nobody's.
 * A day with no entry is CLOSED, and is emitted with empty `intervals` rather
 * than dropped, so the table keeps all seven rows.
 */
const openingHoursDays = (
  hours: VenueConfig['location']['openingHours']
): MicrositeOpeningHoursDay[] => {
  if (!hours) return [];
  return [1, 2, 3, 4, 5, 6, 0].map((day) => {
    const window = hours[day];
    return {
      label: DAY_LABELS[day],
      intervals: window
        ? [`${clockLabel(window.from)} – ${clockLabel(window.to)}`]
        : [],
    };
  });
};

const addressLines = (location: VenueConfig['location']): string[] => {
  const cityLine = [location.city, location.county]
    .filter((part): part is string => !!part?.trim())
    .join(', ');
  return [
    location.addressLine1,
    location.addressLine2,
    cityLine,
    location.postalCode,
  ].filter((line): line is string => !!line?.trim());
};

/**
 * Keyless Google Maps embed + directions link, built HERE because the renderer
 * must never assemble a maps URL — provider and any future key are a server
 * concern. Geo coordinates win over the address when we have them: an embed
 * keyed on a free-text address silently centres on the wrong town often enough
 * to matter.
 */
const mapUrls = (
  location: VenueConfig['location'],
  businessName: string
): Pick<MicrositeLocation, 'mapEmbedUrl' | 'directionsUrl'> => {
  const hasGeo = location.latitude !== null && location.longitude !== null;
  const query = hasGeo
    ? `${location.latitude},${location.longitude}`
    : [businessName, ...addressLines(location)].join(', ');
  const q = encodeURIComponent(query);
  return {
    mapEmbedUrl: `https://www.google.com/maps?q=${q}&output=embed`,
    directionsUrl: `https://www.google.com/maps/dir/?api=1&destination=${q}`,
  };
};

const toService = (
  service: VenueConfig['services'][number],
  currencySymbol: string
): MicrositeService => {
  // A variant service prices from its CHEAPEST variant — the same anchor the
  // booking wizard uses — and `hasVariants` forces the "From X" wording.
  const variantPrices = service.variants
    .map((variant) => variant.priceCents)
    .filter((cents): cents is number => typeof cents === 'number');
  const hasVariants = variantPrices.length > 0;
  const priceCents = hasVariants
    ? Math.min(...variantPrices)
    : service.priceCents;

  return {
    id: service.id,
    name: service.name,
    description: service.description ?? undefined,
    // The venue config already resolves this to the org's real category NAME
    // (from `organization_service_category`, falling back to the legacy enum's
    // label) — so a `services` block's `categoryIds` filter matches on that
    // name. See the interface note in the handover; the contract calls it an id.
    categoryName: service.category || undefined,
    priceLabel: formatServicePrice({
      priceType: service.priceType,
      priceCents,
      currencySymbol,
      hasVariants,
    }),
    durationLabel: durationLabel(service.appointmentDuration),
  };
};

/** Team photos are bare URLs on the venue payload, so we mint stable ids. */
const practitionerAssetId = (id: string) => `practitioner-${id}`;

export const toMicrositeData = (
  venue: VenueConfig,
  bookingUrl: string
): MicrositeData => {
  const businessName = venue.organization.name;

  const gallery: MicrositeAsset[] = venue.photos.map((photo) => ({
    id: photo.id,
    url: photo.url,
    alt: photo.caption?.trim() || businessName,
  }));

  const practitioners: MicrositePractitioner[] = venue.team.map((member) => ({
    id: member.id,
    name: member.name,
    role: member.title ?? undefined,
    bio: member.bio ?? undefined,
    imageAssetId: member.photo ? practitionerAssetId(member.id) : undefined,
  }));

  const assets: Record<string, MicrositeAsset> = {};
  for (const item of gallery) assets[item.id] = item;
  for (const member of venue.team) {
    if (!member.photo) continue;
    const id = practitionerAssetId(member.id);
    assets[id] = { id, url: member.photo, alt: member.name };
  }
  if (venue.organization.logo) {
    assets.logo = {
      id: 'logo',
      url: venue.organization.logo,
      alt: businessName,
    };
  }

  const location: MicrositeLocation = {
    id: venue.location.id,
    name: venue.location.name ?? businessName,
    addressLines: addressLines(venue.location),
    latitude: venue.location.latitude ?? undefined,
    longitude: venue.location.longitude ?? undefined,
    ...mapUrls(venue.location, businessName),
    openingHours: openingHoursDays(venue.location.openingHours),
    // Not in any public payload yet (plan §5). An `opening_hours` block with
    // `showExceptions` renders nothing rather than guessing.
    openingHoursExceptions: [],
  };

  return {
    assets,
    services: venue.services.map((service) =>
      toService(service, venue.currency.symbol)
    ),
    practitioners,
    locations: [location],
    gallery,
    bookingUrl,
    businessName,
  };
};
