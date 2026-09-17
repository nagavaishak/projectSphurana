'use client';

import { CheckIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import { ArrowLeftIcon, CalendarIcon, DownloadIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { readMicrositeAttribution } from '@/components/microsite/attribution';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  type CalendarEvent,
  downloadIcsFile,
  getGoogleCalendarUrl,
  getOutlookCalendarUrl,
} from '@/lib/calendar-links';
import { type MicrositeOrgContext, micrositeLink } from '@/lib/microsite-org';
import { formatServicePrice } from '@/lib/service-price';
import { cn } from '@/lib/utils';
import { branchVenuePath } from './location-chooser';

import { useGetGeneralBookingConfig, useSubmitGeneralBooking } from './api';
import {
  type CartSelection,
  cartPaymentDue,
  computeCartTotal,
  formatMoney,
  paymentDueLabels,
  resolveCart,
  toWizardConfig,
} from './booking-cart';
import type { GeneralBookingResult, TimeSlot } from './types';
import { usePrefillFromPortalSession } from './use-prefill-from-portal-session';
import { type CartLineItem, WizardCartPanel } from './wizard-cart-panel';
import { type GuestDetails, WizardConfirmStep } from './wizard-confirm-step';
import { WizardDateTimeStep } from './wizard-datetime-step';
import { WizardProfessionalStep } from './wizard-professional-step';
import { WizardServicesStep } from './wizard-services-step';
import { longDateInTz, time12InTz } from './wizard-time';

type Step = 'services' | 'professional' | 'time' | 'confirm';

interface BookingWizardContentProps {
  /**
   * WHICH CLINIC. Resolved by the Astro page (host tier or `/sites/{slug}`
   * path tier) and passed down — never parsed out of the URL in here. A
   * component that re-derives the org is a second authority on it, and the two
   * disagree the moment a tier changes.
   */
  organizationSlug: string;
  /**
   * Link context for this microsite tier. `basePath` is '' on a tenant host and
   * `/sites/{slug}` on the path tier; every internal link goes through
   * `micrositeLink` with it so the same component is correct on both.
   */
  orgContext?: Pick<MicrositeOrgContext, 'basePath'>;
  /**
   * WHICH BRANCH. Resolved by the Astro route (`/book/l/{locationSlug}`) and
   * passed down, exactly like `organizationSlug` and for the same reason.
   *
   * It scopes all three public calls: the config the prices come from, the
   * slots the day is drawn from, and the submit that stamps the appointment's
   * branch. Leaving it undefined is the pre-branch behaviour the API still
   * honours (the org's default branch), which is what every single-branch org
   * and the legacy `/book` route rely on.
   */
  locationSlug?: string;
  /** When set (deep link), seed the cart with this service already added. */
  initialServiceId?: string;
  /** How to close the wizard (defaults to browser back). */
  onClose?: () => void;
}

const EMPTY_DETAILS: GuestDetails = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
};

/** Minimal email sanity check — a trimmed `local@domain.tld` shape. */
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

export function BookingWizardContent({
  organizationSlug,
  orgContext,
  locationSlug,
  initialServiceId,
  onClose,
}: BookingWizardContentProps) {
  const {
    config: rawConfig,
    isLoading,
    isError,
    error,
  } = useGetGeneralBookingConfig(organizationSlug, locationSlug);

  const config = useMemo(
    () => (rawConfig ? toWizardConfig(rawConfig) : null),
    [rawConfig]
  );

  const [cart, setCart] = useState<CartSelection[]>([]);
  const [practitionerId, setPractitionerId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [details, setDetails] = useState<GuestDetails>(EMPTY_DETAILS);

  // If this visitor is already signed in to the clinic's portal, fill their
  // details in rather than making an existing customer retype them. Only
  // fields still untouched are populated, so typing always wins.
  const applyPrefill = useCallback((prefill: Partial<GuestDetails>) => {
    setDetails((current) => ({
      firstName: current.firstName || (prefill.firstName ?? ''),
      lastName: current.lastName || (prefill.lastName ?? ''),
      email: current.email || (prefill.email ?? ''),
      phone: current.phone || (prefill.phone ?? ''),
    }));
  }, []);
  usePrefillFromPortalSession(organizationSlug, applyPrefill);
  const [note, setNote] = useState('');
  const [step, setStep] = useState<Step>('services');
  const [bookingResult, setBookingResult] =
    useState<GeneralBookingResult | null>(null);
  // True while we hand off to Stripe checkout — shows a clean "redirecting"
  // screen instead of leaving the confirm form up (and instead of a misleading
  // "confirmed" screen) during the couple of seconds it takes.
  const [redirecting, setRedirecting] = useState(false);

  // Stripe redirects back with `?deposit=success|cancelled` — the in-memory
  // wizard state is gone by then, so we render a standalone confirmation.
  const depositReturn =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('deposit')
      : null;

  const { submitBooking, isSubmitting } = useSubmitGeneralBooking({
    onSuccess: (result) => {
      // Payment gate: when anything is owed online, the appointment is held
      // (reserved) but NOT confirmed until paid. Send the customer straight to
      // Stripe checkout instead of showing a "confirmed" screen. On return,
      // `?deposit=success|cancelled` drives the standalone confirmation below.
      if (result.deposit?.checkoutUrl) {
        setRedirecting(true);
        window.location.href = result.deposit.checkoutUrl;
        return;
      }
      setBookingResult(result);
    },
  });

  // Deep link (`/book/:slug/:serviceId`) seeds the cart once the config
  // loads — but only for a service with NO variants; a variant service needs an
  // explicit option pick, which the customer makes in the Services step.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !config || !initialServiceId) return;
    seededRef.current = true;
    const svc = config.services.find((s) => s.id === initialServiceId);
    if (svc && svc.variants.length === 0) {
      setCart([{ serviceId: svc.id, variantId: null }]);
    }
  }, [config, initialServiceId]);

  // If the cart changes so the chosen practitioner can no longer perform every
  // selected service, drop the selection (and its slot) back to "any" — keeping
  // it would scope the slots query to a service they aren't assigned to and
  // dead-end with "no available times". Declared here (before any early return)
  // to keep hook order stable.
  useEffect(() => {
    if (!config || practitionerId == null) return;
    const stillEligible = cart.every((c) => {
      const p = config.practitioners.find((pr) => pr.id === practitionerId);
      return p?.serviceIds.includes(c.serviceId) ?? false;
    });
    if (!stillEligible) {
      setPractitionerId(null);
      setSelectedSlot(null);
    }
  }, [config, cart, practitionerId]);

  const closeWizard = () => {
    if (onClose) return onClose();
    if (typeof window === 'undefined') return;

    // Always the VENUE page — never `history.back()`.
    //
    // Back used to walk the browser's history, which is only the venue page if
    // that is genuinely where the customer came from. Arriving from an ad, a
    // Claire link, a bookmark or a refresh, it lands anywhere: on a search
    // page, on an earlier state of the booking wizard itself, or nowhere at
    // all. The customer presses back and appears not to move.
    //
    // The venue page is the right destination in every one of those cases: it
    // is where the services, prices and address live, so it is what "out of
    // the booking flow" means for this business.
    // THIS BRANCH's venue page when the wizard is branch-scoped. The bare
    // `/venue` applies the entry rules and would show the chooser again — so a
    // customer already inside Cork's flow would be asked to pick a branch on
    // the way out, which reads as having lost their place.
    window.location.href = micrositeLink(
      orgContext ?? { basePath: '' },
      locationSlug ? branchVenuePath(locationSlug) : '/venue'
    );
  };

  // ── Loading / error ──────────────────────────────────────────────────────
  if (isLoading || !rawConfig || !config) {
    if (isError) {
      return (
        <div className="flex min-h-screen items-center justify-center">
          <div className="text-center">
            <h1 className="mb-2 font-semibold text-2xl">Page not found</h1>
            <p className="text-muted-foreground">
              {error?.message ?? "This booking page doesn't exist."}
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Skeleton className="h-10 w-40" />
        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_360px]">
          <Skeleton className="h-96 w-full" />
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  const symbol = config.currency.symbol;

  // Only offer practitioners who can perform EVERY service in the cart —
  // otherwise picking them scopes the slots query to a service they aren't
  // assigned to, which dead-ends with "no available times" on every date.
  // Before any service is chosen, show the full team.
  const selectedServiceIds = cart.map((c) => c.serviceId);
  const eligiblePractitioners =
    selectedServiceIds.length === 0
      ? config.practitioners
      : config.practitioners.filter((p) =>
          selectedServiceIds.every((id) => p.serviceIds.includes(id))
        );
  const hasProfessionalStep = eligiblePractitioners.length > 0;

  const orderedSteps: Step[] = hasProfessionalStep
    ? ['services', 'professional', 'time', 'confirm']
    : ['services', 'time', 'confirm'];

  const selectedIds = cart.map((c) => c.serviceId);
  const resolvedLines = resolveCart(config, cart);

  const practitionerName =
    practitionerId != null
      ? (config.practitioners.find((p) => p.id === practitionerId)?.name ??
        null)
      : null;

  const cartItems: CartLineItem[] = resolvedLines.map((line) => ({
    ...line,
    practitionerName,
  }));

  const total = computeCartTotal(resolvedLines);
  const totalDuration = resolvedLines.reduce(
    (acc, line) => acc + line.durationMinutes,
    0
  );
  // What this cart costs online, from the same resolver the server charges by.
  // > 0 turns the confirm CTA into a pay-and-book button and shows the amount
  // in the summary; `reason` decides whether that reads "deposit" or the lot.
  const paymentDue = cartPaymentDue(config, cart);
  const depositDueCents = paymentDue.amountCents;
  const primaryServiceId = cart[0]?.serviceId ?? '';

  const addToCart = (serviceId: string, variantId: string | null) =>
    setCart((prev) => [
      ...prev.filter((c) => c.serviceId !== serviceId),
      { serviceId, variantId },
    ]);
  const removeFromCart = (serviceId: string) =>
    setCart((prev) => prev.filter((c) => c.serviceId !== serviceId));

  // ── Redirecting to Stripe ─────────────────────────────────────────────────
  // This is the screen a paying customer actually sees (the confirmation-screen
  // Pay button below only shows for a charge with no checkout URL), so it is
  // the one that most needs to name the charge correctly.
  if (redirecting) {
    return (
      <ConfirmationScreen
        title="Redirecting to secure payment…"
        subtitle={
          paymentDue.reason === 'deposit'
            ? "Hold on — we're taking you to Stripe to pay your deposit and confirm your appointment."
            : "Hold on — we're taking you to Stripe to pay for and confirm your appointment."
        }
      />
    );
  }

  // ── Payment return (standalone) ──────────────────────────────────────────
  // A fresh page load back from Stripe: the cart is empty, so there is no
  // `reason` to hand here. The copy says "payment" rather than guessing
  // "deposit" — true whether the charge was a deposit or the full price.
  if (depositReturn === 'success' || depositReturn === 'cancelled') {
    const paid = depositReturn === 'success';
    return (
      <ConfirmationScreen
        title={paid ? 'Appointment confirmed' : 'Payment cancelled'}
        subtitle={
          paid
            ? 'Your payment has been received and your appointment is confirmed.'
            : 'Your payment was not completed, so your booking is not yet confirmed. Please contact us to complete it.'
        }
      />
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (bookingResult) {
    const pendingDeposit = bookingResult.deposit ?? null;
    // Name the charge by the reason the SERVER resolved it under, not by
    // assuming "deposit" — `full` is the whole price.
    const pendingIsDeposit =
      (pendingDeposit?.reason ?? 'deposit') === 'deposit';
    return (
      <ConfirmationScreen
        // An unpaid balance means the slot is held, not confirmed. Saying
        // "Appointment confirmed" above a Pay button tells the customer the job
        // is done and invites them to close the tab.
        title={pendingDeposit ? 'Almost there' : 'Appointment confirmed'}
        subtitle={
          pendingDeposit
            ? pendingIsDeposit
              ? 'Your slot is held — pay your deposit below to confirm it.'
              : 'Your slot is held — pay below to confirm it.'
            : "Your appointment is booked. We'll be in touch soon."
        }
      >
        <Card className="mt-8 w-full max-w-md">
          <CardContent className="space-y-4 pt-6">
            {selectedSlot && selectedDate && (
              <div className="rounded-lg bg-muted p-4 text-sm">
                <p className="font-medium">
                  {longDateInTz(selectedSlot.startTime, config.timezone)}
                </p>
                <p className="text-muted-foreground">
                  {time12InTz(selectedSlot.startTime, config.timezone)}
                </p>
              </div>
            )}
            <ul className="space-y-2 text-sm">
              {resolvedLines.map((line) => (
                <li
                  key={`${line.serviceId}:${line.variantId ?? ''}`}
                  className="flex justify-between gap-4"
                >
                  <span>
                    {line.name}
                    {line.variantName ? ` · ${line.variantName}` : ''}
                  </span>
                  <span className="text-muted-foreground">
                    {formatServicePrice({
                      priceType: line.priceType,
                      priceCents: line.priceCents,
                      currencySymbol: symbol,
                    })}
                  </span>
                </li>
              ))}
            </ul>

            {pendingDeposit ? (
              <Button
                className="w-full"
                onClick={() => {
                  window.location.href = pendingDeposit.checkoutUrl;
                }}
              >
                Pay{' '}
                {formatMoney(
                  pendingDeposit.amountCents,
                  pendingDeposit.currency.toLowerCase() === 'gbp'
                    ? '£'
                    : pendingDeposit.currency.toLowerCase() === 'usd'
                      ? '$'
                      : '€'
                )}
                {pendingIsDeposit ? ' deposit' : ''}
              </Button>
            ) : (
              selectedSlot && (
                <AddToCalendar
                  event={{
                    title: resolvedLines[0]?.name ?? 'Appointment',
                    description: `Appointment with ${config.organizationName}`,
                    startTime: new Date(selectedSlot.startTime),
                    endTime: new Date(
                      new Date(selectedSlot.startTime).getTime() +
                        totalDuration * 60_000
                    ),
                    // The address of the BRANCH this booking is at — the
                    // config is branch-scoped, so this is Cork's address on a
                    // Cork booking. Without it the calendar entry has no
                    // place: on the day the customer's phone offers no
                    // navigation and the reminder names no branch. `undefined`
                    // when the org has no address on file, which the link
                    // builders already omit rather than sending empty.
                    location: config.organizationAddress ?? undefined,
                  }}
                />
              )
            )}
          </CardContent>
        </Card>
      </ConfirmationScreen>
    );
  }

  // ── CTA wiring per step ──────────────────────────────────────────────────
  const goToStep = (target: Step) => setStep(target);
  const currentIndex = orderedSteps.indexOf(step);
  const nextStep = () => {
    const next = orderedSteps[currentIndex + 1];
    if (next) setStep(next);
  };
  const back = () => {
    const prev = orderedSteps[currentIndex - 1];
    if (prev) setStep(prev);
    else closeWizard();
  };

  const handleSubmit = () => {
    const attribution =
      typeof window !== 'undefined'
        ? readMicrositeAttribution(window.location.href)
        : {};
    if (
      !selectedSlot ||
      !details.firstName.trim() ||
      !isValidEmail(details.email) ||
      !primaryServiceId
    )
      return;
    const startTime = new Date(selectedSlot.startTime);
    const endTime = new Date(startTime.getTime() + totalDuration * 60_000);
    submitBooking({
      organizationSlug,
      serviceId: primaryServiceId,
      serviceIds: selectedIds,
      // Structured cart: each line names its chosen variant (when any). The
      // server snapshots the variant's price/duration and this takes precedence
      // over `serviceIds`.
      serviceItems: cart.map((c) => ({
        serviceId: c.serviceId,
        variantId: c.variantId ?? undefined,
      })),
      firstName: details.firstName.trim(),
      lastName: details.lastName.trim() || undefined,
      email: details.email.trim() || undefined,
      phone: details.phone.trim() || undefined,
      notes: note.trim() || undefined,
      appointmentStartTime: startTime,
      appointmentEndTime: endTime,
      practitionerId: practitionerId ?? undefined,
      // The branch the customer chose, stamped on the appointment by the
      // server. Spread conditionally so a branch-less booking posts a body
      // with no `locationSlug` key at all — byte-identical to what a
      // single-branch org has always sent.
      ...(locationSlug ? { locationSlug } : {}),
      // Where Stripe returns the customer to. apps/app rewrites this onto the
      // web-app origin (native WebViews have a `capacitor://` origin that is
      // useless in a redirect URL); on a microsite the page origin IS the
      // public one, so it is used as-is — sending them back to app.borradh.io
      // would drop them out of the clinic's own site mid-payment.
      bookingPageUrl:
        typeof window !== 'undefined'
          ? `${window.location.origin}${window.location.pathname}`
          : undefined,
      // Microsite attribution (plan §9, §11) — the query string `bookingPageUrl`
      // above deliberately drops is exactly what the CAC join needs, so it is
      // sent separately and whole. `ms` was put on this URL by the microsite
      // page; a direct visit simply has neither, and the server skips the write.
      ...attribution,
    });
  };

  let ctaLabel = 'Continue';
  let ctaDisabled = false;
  let onCta = nextStep;

  if (step === 'services') {
    ctaDisabled = selectedIds.length === 0;
  } else if (step === 'time') {
    ctaDisabled = !selectedSlot;
  } else if (step === 'confirm') {
    // `full` prepay is the whole price, not a deposit — promising "deposit" and
    // then charging the lot at Stripe is the same lie in the other direction.
    // Same helper as the cart summary line, so the button and the figure right
    // above it can't describe the charge differently.
    ctaLabel = paymentDueLabels(
      depositDueCents === 0 ? 'none' : paymentDue.reason
    ).cta;
    // Require a name AND a valid email before booking — a paid booking is sent
    // to Stripe, so we must capture who the customer is (confirmation + manage
    // link + receipt). Email was previously optional, which let a paid booking
    // proceed with no contact details.
    ctaDisabled = !details.firstName.trim() || !isValidEmail(details.email);
    onCta = handleSubmit;
  }

  const showSchedule = step === 'confirm' && selectedSlot;

  return (
    <div className="min-h-screen bg-muted/30">
      <WizardHeader
        steps={orderedSteps}
        currentStep={step}
        onStepClick={(target) => {
          if (orderedSteps.indexOf(target) < currentIndex) goToStep(target);
        }}
        onBack={back}
        onClose={closeWizard}
      />

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
        <div className="min-w-0">
          {step === 'services' && (
            <WizardServicesStep
              services={config.services}
              currencySymbol={symbol}
              selectedIds={selectedIds}
              onAdd={addToCart}
              onRemove={removeFromCart}
            />
          )}

          {step === 'professional' && (
            <WizardProfessionalStep
              practitioners={eligiblePractitioners}
              selectedPractitionerId={practitionerId}
              onSelect={(id) => {
                setPractitionerId(id);
                setSelectedSlot(null);
              }}
            />
          )}

          {step === 'time' && primaryServiceId && (
            <WizardDateTimeStep
              config={config}
              primaryServiceId={primaryServiceId}
              durationMinutes={totalDuration}
              practitionerId={practitionerId ?? undefined}
              locationSlug={locationSlug}
              selectedSlot={selectedSlot}
              onSelect={(slot, date) => {
                setSelectedSlot(slot);
                setSelectedDate(date);
              }}
            />
          )}

          {step === 'confirm' && (
            <WizardConfirmStep
              config={config}
              currencySymbol={symbol}
              details={details}
              onDetailsChange={setDetails}
              note={note}
              onNoteChange={setNote}
            />
          )}
        </div>

        <WizardCartPanel
          config={config}
          items={cartItems}
          total={total}
          currencySymbol={symbol}
          schedule={
            showSchedule && selectedSlot
              ? {
                  startTime: selectedSlot.startTime,
                  durationMinutes: totalDuration,
                }
              : null
          }
          depositDueCents={step === 'confirm' ? depositDueCents : 0}
          paymentDueReason={paymentDue.reason}
          ctaLabel={ctaLabel}
          ctaDisabled={ctaDisabled}
          ctaLoading={isSubmitting}
          onCta={onCta}
        />
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header (back + breadcrumb stepper + close)
// ---------------------------------------------------------------------------

const STEP_LABELS: Record<Step, string> = {
  services: 'Services',
  professional: 'Professional',
  time: 'Time',
  confirm: 'Confirm',
};

function WizardHeader({
  steps,
  currentStep,
  onStepClick,
  onBack,
  onClose,
}: {
  steps: Step[];
  currentStep: Step;
  onStepClick: (step: Step) => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const currentIndex = steps.indexOf(currentStep);
  return (
    <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-4 md:px-6">
      <div className="flex items-center gap-4">
        <Button
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label="Go back"
          onClick={onBack}
        >
          <ArrowLeftIcon className="size-4" />
        </Button>
        <nav
          aria-label="Progress"
          className="hidden items-center gap-2 sm:flex"
        >
          {steps.map((s, i) => {
            const done = i < currentIndex;
            const active = i === currentIndex;
            return (
              <div key={s} className="flex items-center gap-2">
                {i > 0 && (
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                )}
                <button
                  type="button"
                  disabled={!done}
                  onClick={() => onStepClick(s)}
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'text-sm transition-colors',
                    active
                      ? 'font-semibold text-foreground'
                      : done
                        ? 'text-foreground hover:underline'
                        : 'text-muted-foreground'
                  )}
                >
                  {STEP_LABELS[s]}
                </button>
              </div>
            );
          })}
        </nav>
      </div>
      <Button
        variant="outline"
        size="icon"
        className="rounded-full"
        aria-label="Close"
        onClick={onClose}
      >
        <XIcon className="size-4" />
      </Button>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Confirmation screen
// ---------------------------------------------------------------------------

function ConfirmationScreen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-12 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
        <CheckIcon className="size-8 text-primary" />
      </div>
      <h1 className="mt-6 font-bold text-3xl text-foreground md:text-4xl">
        {title}
      </h1>
      {subtitle && (
        <p className="mt-2 max-w-md text-muted-foreground">{subtitle}</p>
      )}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add to calendar
// ---------------------------------------------------------------------------

function AddToCalendar({ event }: { event: CalendarEvent }) {
  return (
    <div className="space-y-2">
      <p className="text-center font-medium text-sm">Add to your calendar</p>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button variant="outline" size="sm" asChild>
          <a
            href={getGoogleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <CalendarIcon className="mr-1.5 size-4" />
            Google
          </a>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <a
            href={getOutlookCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <CalendarIcon className="mr-1.5 size-4" />
            Outlook
          </a>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadIcsFile(event)}
        >
          <DownloadIcon className="mr-1.5 size-4" />
          .ics
        </Button>
      </div>
    </div>
  );
}
