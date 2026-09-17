import type {
  MicrositeAsset,
  MicrositeData,
  MicrositeLocation,
} from '@borradh-workspace/web-shared';

// The wire types live in the contract package — see the note there on why
// this was a two-sided copy. Re-exported so local imports are unchanged.
export type {
  MicrositeAsset,
  MicrositeData,
  MicrositeLocation,
  MicrositeOpeningHoursDay,
  MicrositeOpeningHoursException,
  MicrositePractitioner,
  MicrositeService,
} from '@borradh-workspace/web-shared';
/**
 * The props a PAGE must satisfy to render a MicrositeDocument.
 *
 * Data-bound blocks (`services`, `team`, `opening_hours`, `map_location`) hold
 * a QUERY in `block.props`, never a copy of the business data — see the
 * contract in `@borradh-workspace/web-shared`. So the page fetches once, hands
 * the whole `MicrositeData` bundle down, and each block SELECTS from it using
 * its own props. Blocks never fetch, and never read business data out of
 * `block.props`.
 *
 * Everything here is deliberately view-shaped, not database-shaped: prices
 * arrive pre-formatted (the source of truth is `formatServicePrice()` on the
 * server — see plan §5; the renderer must never re-derive a price), and hours
 * arrive as already-localised label strings.
 */

/** Resolve an asset id against the bundle. Missing ids are simply absent. */
export const asset = (
  data: MicrositeData,
  id: string | undefined | null
): MicrositeAsset | undefined => (id ? data.assets[id] : undefined);

/** `locationId` selects a location; an unknown or absent id falls back to the first. */
export const pickLocation = (
  data: MicrositeData,
  locationId?: string
): MicrositeLocation | undefined =>
  (locationId ? data.locations.find((l) => l.id === locationId) : undefined) ??
  data.locations[0];

/**
 * Unknown variants render the FIRST variant rather than throwing. A block the
 * agent wrote against a newer variant list must degrade, never take down the
 * tenant's page.
 */
export const resolveVariant = <T extends string>(
  variant: string | undefined,
  variants: readonly T[]
): T =>
  (variants as readonly string[]).includes(variant ?? '')
    ? (variant as T)
    : variants[0];
