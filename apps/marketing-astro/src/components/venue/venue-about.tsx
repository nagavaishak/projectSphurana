import { cn } from '@/lib/utils';
import type { VenueConfig } from '@borradh-workspace/contracts';
import { directionsUrl, formatAddress, mapEmbedUrl } from './venue-address';
import { buildOpeningHoursRows } from './venue-hours';

interface VenueAboutProps {
  venue: VenueConfig;
}

/**
 * The About block plus the map and opening-hours table. Everything here is
 * time-zone aware via the rows builder, and the map is a keyless Google Maps
 * embed (only when we have coordinates).
 */
export function VenueAbout({ venue }: VenueAboutProps) {
  const { organization, location } = venue;
  const embed = mapEmbedUrl(location);
  const address = formatAddress(location);
  const rows = buildOpeningHoursRows(
    location.openingHours,
    organization.timezone
  );

  return (
    <>
      {location.about && (
        <section id="about" className="space-y-3">
          <h2 className="font-bold text-2xl">About</h2>
          <p className="whitespace-pre-line text-muted-foreground leading-relaxed">
            {location.about}
          </p>
        </section>
      )}

      {embed && (
        <section className="space-y-2">
          <iframe
            title={`Map of ${location.name ?? organization.name}`}
            src={embed}
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
            className="aspect-[2/1] w-full rounded-2xl border"
          />
          <p className="text-muted-foreground text-sm">
            {address}{' '}
            <a
              href={directionsUrl(location)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              Get directions
            </a>
          </p>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="font-bold text-2xl">Opening times</h2>
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.day}
              className={cn(
                'flex items-center justify-between gap-4 text-sm sm:max-w-sm',
                row.isToday && 'font-semibold'
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-2 rounded-full',
                    row.closed ? 'bg-muted-foreground/40' : 'bg-green-500'
                  )}
                />
                {row.day}
              </span>
              <span className={cn(row.closed && 'text-muted-foreground')}>
                {row.hours}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
