import { formatServicePrice } from '@borradh-workspace/labels';
import { ArrowRightIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import type { WebsiteAnalysisPlan } from '../../api/types';
import { type PlanGroupSpec, PlanSection } from './plan-section';
import { VALUE_KEYS } from './plan-selection';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(
    minutes % 60
  ).padStart(2, '0')}`;

export const formatHours = (
  hours: Record<string, { from: number; to: number }> | null
) => {
  if (!hours || Object.keys(hours).length === 0) return null;
  return Object.entries(hours)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(
      ([day, { from, to }]) =>
        `${DAY_NAMES[Number(day)]} ${formatMinutes(from)}–${formatMinutes(to)}`
    )
    .join(' · ');
};

/** The switch-off group's shared framing — stated once, next to the ticks. */
const SWITCH_OFF_HINT =
  'Ticking these switches them off. Nothing is deleted, and your booking history keeps working.';

interface PlanReviewProps {
  plan: WebsiteAnalysisPlan;
  selected: ReadonlySet<string>;
  onToggle: (key: string, checked: boolean) => void;
  onToggleMany: (keys: string[], checked: boolean) => void;
  /** The account's own currency, for prices that are already in the account. */
  accountCurrencySymbol: string;
}

/**
 * The reviewable diff between a scan and the account.
 *
 * Every row is a checkbox and nothing else decides what happens — there is no
 * per-section mode to reconcile against the list, because "replace" was only
 * ever "tick the rows the site no longer lists".
 */
export function PlanReview({
  plan,
  selected,
  onToggle,
  onToggleMany,
  accountCurrencySymbol,
}: PlanReviewProps) {
  // These prices came off the owner's WEBSITE, so they are shown in the
  // currency the website publishes. Formatting them with the account currency
  // would tell a UK owner their site says `€600` when it says `£600` — on the
  // one screen whose whole job is showing exactly what will change.
  const scannedSymbol = plan.scannedCurrencySymbol ?? accountCurrencySymbol;

  const scannedPrice = (priceType: string, priceCents: number | null) =>
    formatServicePrice({
      priceType: priceType as never,
      priceCents,
      currencySymbol: scannedSymbol,
    });

  const accountPrice = (priceType: string, priceCents: number | null) =>
    formatServicePrice({
      priceType: priceType as never,
      priceCents,
      currencySymbol: accountCurrencySymbol,
    });

  const switchOffGroup = (
    rows: { key: string; name: string }[]
  ): PlanGroupSpec => ({
    label: 'Not on your website any more',
    hint: SWITCH_OFF_HINT,
    tone: 'destructive',
    rows: rows.map((row) => ({ key: row.key, content: row.name })),
  });

  return (
    <div className="space-y-8">
      {plan.scanned.includes('services') ? (
        <PlanSection
          emptyLabel={`No changes — ${plan.services.unchanged} service${
            plan.services.unchanged === 1 ? '' : 's'
          } already match your website.`}
          groups={[
            {
              rows: [
                ...plan.services.create.map((service) => ({
                  key: service.key,
                  content: (
                    <>
                      {service.name}{' '}
                      <Badge variant="secondary">
                        {scannedPrice(service.priceType, service.priceCents)}
                      </Badge>
                    </>
                  ),
                })),
                ...plan.services.priceChanges.map((change) => ({
                  key: change.key,
                  content: (
                    <>
                      {change.name}{' '}
                      <span className="text-muted-foreground line-through">
                        {accountPrice(
                          change.fromPriceType,
                          change.fromPriceCents
                        )}
                      </span>
                      <ArrowRightIcon className="mx-1 inline size-3" />
                      <Badge variant="secondary">
                        {scannedPrice(change.priceType, change.priceCents)}
                      </Badge>
                    </>
                  ),
                })),
              ],
            },
            switchOffGroup(plan.services.notFound),
          ]}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Services & prices"
        />
      ) : null}

      {plan.scanned.includes('packages') ? (
        <PlanSection
          emptyLabel="No packages found on your website."
          groups={[
            {
              rows: plan.packages.create.map((pkg) => ({
                key: pkg.key,
                content: (
                  <>
                    {pkg.name}{' '}
                    <Badge variant="secondary">
                      {scannedPrice('fixed', pkg.priceCents)}
                    </Badge>{' '}
                    <span className="text-muted-foreground text-xs">
                      {pkg.serviceNames.join(', ')}
                    </span>
                  </>
                ),
              })),
            },
            switchOffGroup(plan.packages.notFound),
          ]}
          notes={plan.packages.blocked}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Packages & bundles"
        />
      ) : null}

      {plan.scanned.includes('team') ? (
        <PlanSection
          emptyLabel="No team members found on your website."
          groups={[
            {
              rows: plan.team.create.map((member) => ({
                key: member.key,
                content: (
                  <>
                    {member.name}
                    {member.title ? (
                      <span className="text-muted-foreground">
                        {' '}
                        — {member.title}
                      </span>
                    ) : null}
                  </>
                ),
              })),
            },
            switchOffGroup(plan.team.notFound),
          ]}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Team members"
        />
      ) : null}

      {plan.scanned.includes('location') ? (
        <PlanSection
          emptyLabel={
            plan.locations.matched > 0
              ? 'Your address already matches your website.'
              : 'No address found on your website.'
          }
          groups={[
            {
              rows: plan.locations.create.map((location) => ({
                key: location.key,
                content: [
                  location.addressLine1,
                  location.city,
                  location.postalCode,
                ]
                  .filter(Boolean)
                  .join(', '),
              })),
            },
          ]}
          notes={plan.locations.blocked}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Location & address"
        />
      ) : null}

      {plan.scanned.includes('description') ? (
        <PlanSection
          emptyLabel="We could not write a description from your website."
          groups={[
            {
              rows: plan.description.scanned
                ? [
                    {
                      key: VALUE_KEYS.description,
                      content: (
                        <div className="space-y-1">
                          <p>{plan.description.scanned}</p>
                          {plan.description.current ? (
                            <p className="text-muted-foreground text-xs">
                              Replaces: {plan.description.current}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                  ]
                : [],
            },
          ]}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Booking page description"
        />
      ) : null}

      {plan.scanned.includes('hours') ? (
        <PlanSection
          emptyLabel="No opening hours found on your website."
          groups={[
            {
              rows: plan.hours.scanned
                ? [
                    {
                      key: VALUE_KEYS.hours,
                      content: (
                        <div className="space-y-1">
                          <p>{formatHours(plan.hours.scanned)}</p>
                          {plan.hours.current ? (
                            <p className="text-muted-foreground text-xs">
                              Replaces: {formatHours(plan.hours.current)}
                            </p>
                          ) : null}
                        </div>
                      ),
                    },
                  ]
                : [],
            },
          ]}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Opening hours"
        />
      ) : null}

      {plan.scanned.includes('brand') ? (
        <PlanSection
          emptyLabel="No brand details found on your website."
          groups={[
            {
              rows:
                plan.brand.scanned.primaryColor || plan.brand.scanned.logoUrl
                  ? [
                      {
                        key: VALUE_KEYS.brand,
                        content: (
                          <span className="inline-flex flex-wrap items-center gap-2">
                            {[
                              plan.brand.scanned.logoUrl ? 'Logo' : null,
                              plan.brand.scanned.primaryColor
                                ? 'brand colours'
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' and ')}
                            {plan.brand.scanned.primaryColor ? (
                              <span
                                className="inline-block size-3 rounded-full border align-middle"
                                style={{
                                  background: plan.brand.scanned.primaryColor,
                                }}
                              />
                            ) : null}
                            {plan.brand.scanned.secondaryColor ? (
                              <span
                                className="inline-block size-3 rounded-full border align-middle"
                                style={{
                                  background: plan.brand.scanned.secondaryColor,
                                }}
                              />
                            ) : null}
                          </span>
                        ),
                      },
                    ]
                  : [],
            },
          ]}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
          title="Brand details"
        />
      ) : null}
    </div>
  );
}
