import { branchBookingPath } from '@/components/booking/location-chooser';
import { Button } from '@/components/ui/button';
import { serviceCategoryChips } from '@/lib/service-categories';
import { cn } from '@/lib/utils';
import type { VenueConfig } from '@borradh-workspace/contracts';
import { formatServicePrice } from '@borradh-workspace/labels';
import { useMemo, useState } from 'react';

type VenueService = VenueConfig['services'][number];

interface VenueServicesProps {
  organizationSlug: string;
  /**
   * The BRANCH this page resolved — `slug ?? id`.
   *
   * Required, not optional. Every service row below is this branch's, priced
   * at this branch's rates, so a Book button that drops the branch sends the
   * customer to the chooser and asks them to pick the location they are
   * already standing on. Making it optional would let a new caller reintroduce
   * that silently.
   */
  branchSegment: string;
  services: VenueService[];
  /** The org display currency symbol — price display derives from this. */
  currencySymbol: string;
}

const ALL_CATEGORY = 'Featured';

function formatDuration(minutes: number | null): string | null {
  if (minutes == null) return null;
  return `${minutes} mins`;
}

/**
 * The one canonical price string, derived from (priceType, priceCents, variants)
 * — never the deprecated freeform `priceText`. `poa` renders "Price on
 * consultation", so a price always shows.
 */
function formatPrice(service: VenueService, currencySymbol: string): string {
  return formatServicePrice({
    priceType: service.priceType,
    priceCents: service.priceCents,
    currencySymbol,
    hasVariants: service.variants.length > 0,
  });
}

/**
 * The Services block: category chips that filter the rows below, each service
 * row deep-linking into the booking wizard pre-seeded with that service. The
 * top-of-page "Book now" starts the wizard with no service chosen.
 */
export function VenueServices({
  organizationSlug,
  branchSegment,
  services,
  currencySymbol,
}: VenueServicesProps) {
  // Empty when chips would not split the list — an org with nothing
  // categorised gets no chip row at all rather than one that filters nothing.
  const realCategories = useMemo(
    () => serviceCategoryChips(services),
    [services]
  );
  const categories = useMemo(
    () => (realCategories.length > 0 ? [ALL_CATEGORY, ...realCategories] : []),
    [realCategories]
  );

  const [active, setActive] = useState(ALL_CATEGORY);

  const visible =
    active === ALL_CATEGORY
      ? services
      : services.filter((s) => s.category === active);

  if (services.length === 0) {
    return (
      <section id="services" className="space-y-4">
        <h2 className="font-bold text-2xl">Services</h2>
        <p className="text-muted-foreground text-sm">No services listed yet.</p>
      </section>
    );
  }

  return (
    <section id="services" className="space-y-4">
      <h2 className="font-bold text-2xl">Services</h2>

      {categories.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Service categories"
        >
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              role="tab"
              aria-selected={active === category}
              onClick={() => setActive(category)}
              className={cn(
                'rounded-full border px-4 py-2 text-sm transition-colors',
                active === category
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input bg-background hover:bg-accent'
              )}
            >
              {category}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-3">
        {visible.map((service) => {
          const duration = formatDuration(service.appointmentDuration);
          const price = formatPrice(service, currencySymbol);
          return (
            <li
              key={service.id}
              className="flex items-center justify-between gap-4 rounded-xl border p-5"
            >
              <div className="min-w-0 space-y-1">
                <p className="font-medium">{service.name}</p>
                {duration && (
                  <p className="text-muted-foreground text-sm">{duration}</p>
                )}
                {service.description && (
                  <p className="line-clamp-2 text-muted-foreground text-sm">
                    {service.description}
                  </p>
                )}
                {price && <p className="font-medium text-sm">{price}</p>}
              </div>
              <Button
                asChild
                variant="outline"
                className="shrink-0 rounded-full"
              >
                {/* Leaves this origin: booking is on the microsite now.
                    Carries the BRANCH — see `branchSegment` above. */}
                <a
                  href={`/sites/${encodeURIComponent(organizationSlug)}${branchBookingPath(branchSegment, service.id)}`}
                >
                  Book
                </a>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
