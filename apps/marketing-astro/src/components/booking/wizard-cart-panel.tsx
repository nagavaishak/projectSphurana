'use client';

import { ArrowRightIcon, CalendarIcon, ClockIcon } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { formatServicePrice } from '@/lib/service-price';

import {
  type CartTotal,
  type ResolvedCartLine,
  type WizardConfig,
  formatCartTotal,
  formatDuration,
  formatMoney,
  paymentDueLabels,
} from './booking-cart';
import type { ResolvedBookingPayment } from './types';
import {
  time12InTz,
  time12NoMeridiemInTz,
  weekdayDayMonthInTz,
} from './wizard-time';

export interface CartLineItem extends ResolvedCartLine {
  /** Practitioner rendered as "· with {name}" when a specific one is chosen. */
  practitionerName: string | null;
}

interface WizardCartPanelProps {
  config: WizardConfig;
  items: CartLineItem[];
  total: CartTotal;
  currencySymbol: string;
  /** When set, render the date/time/duration block (Confirm step). */
  schedule?: {
    startTime: string;
    durationMinutes: number;
  } | null;
  /** Amount due online to confirm (cents). > 0 renders the due-today line. */
  depositDueCents?: number;
  /**
   * Why that amount is due. The line is labelled from it — a `full` prepay is
   * not a deposit, and this panel used to call every amount one.
   */
  paymentDueReason?: ResolvedBookingPayment['reason'];
  ctaLabel: string;
  ctaDisabled?: boolean;
  ctaLoading?: boolean;
  onCta: () => void;
}

/**
 * The persistent right-hand summary panel shared across every wizard step:
 * venue header, the (optional) chosen date/time, the selected service line
 * items, the running total, and the step's primary action.
 */
export function WizardCartPanel({
  config,
  items,
  total,
  currencySymbol,
  schedule,
  depositDueCents = 0,
  paymentDueReason = 'deposit',
  ctaLabel,
  ctaDisabled,
  ctaLoading,
  onCta,
}: WizardCartPanelProps) {
  const startIso = schedule?.startTime ?? null;
  const endIso = schedule
    ? new Date(
        new Date(schedule.startTime).getTime() +
          schedule.durationMinutes * 60_000
      ).toISOString()
    : null;

  return (
    <aside
      aria-label="Booking summary"
      className="flex w-full flex-col rounded-2xl border bg-card p-6 shadow-sm md:sticky md:top-[6.25rem] md:h-[calc(100vh-8.5rem)] md:max-w-sm"
    >
      {/* Venue header */}
      <div className="flex items-center gap-3">
        <Avatar className="size-14 rounded-xl">
          {config.organizationLogo && (
            <AvatarImage
              src={config.organizationLogo}
              alt={config.organizationName}
              className="rounded-xl"
            />
          )}
          <AvatarFallback className="rounded-xl text-sm">
            {config.organizationName.substring(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate font-semibold">{config.organizationName}</p>
          {config.organizationAddress && (
            <p className="truncate text-sm text-muted-foreground">
              {config.organizationAddress}
            </p>
          )}
        </div>
      </div>

      {/* Chosen date / time (Confirm step) */}
      {startIso && endIso && (
        <>
          <Separator className="my-4" />
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <CalendarIcon className="size-4 text-muted-foreground" />
              <span>{weekdayDayMonthInTz(startIso, config.timezone)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <ClockIcon className="size-4 text-muted-foreground" />
              <span>
                {time12NoMeridiemInTz(startIso, config.timezone)}–
                {time12InTz(endIso, config.timezone)} (
                {formatDuration(schedule?.durationMinutes ?? 0)} duration)
              </span>
            </div>
          </div>
        </>
      )}

      <Separator className="my-4" />

      {/* Line items */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No services selected yet.
          </p>
        ) : (
          <ul className="space-y-4">
            {items.map((item) => (
              <li
                key={`${item.serviceId}:${item.variantId ?? ''}`}
                className="flex items-start justify-between gap-4"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.name}
                    {item.variantName ? (
                      <span className="text-muted-foreground">
                        {' '}
                        · {item.variantName}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {formatDuration(item.durationMinutes)}
                    {item.practitionerName
                      ? ` with ${item.practitionerName}`
                      : ''}
                  </p>
                </div>
                <span className="shrink-0 font-medium">
                  {formatServicePrice({
                    priceType: item.priceType,
                    priceCents: item.priceCents,
                    currencySymbol,
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Separator className="my-4" />

      {/* Total */}
      <div className="flex items-center justify-between">
        <span className="font-semibold">Total</span>
        <span className="font-semibold" data-testid="cart-total">
          {formatCartTotal(total, currencySymbol)}
        </span>
      </div>

      {/* Due today (Confirm step, when anything is payable online) */}
      {depositDueCents > 0 && (
        <div
          className="mt-2 flex items-center justify-between text-sm"
          data-testid="cart-deposit-due"
        >
          <span className="text-muted-foreground">
            {paymentDueLabels(paymentDueReason).summary}
          </span>
          <span className="font-medium">
            {formatMoney(depositDueCents, currencySymbol)}
          </span>
        </div>
      )}

      {/* Primary action */}
      <Button
        className="mt-6 w-full"
        size="lg"
        disabled={ctaDisabled || ctaLoading}
        onClick={onCta}
      >
        {ctaLoading ? 'Please wait…' : ctaLabel}
        {!ctaLoading && <ArrowRightIcon className="ml-1 size-4" />}
      </Button>
    </aside>
  );
}
