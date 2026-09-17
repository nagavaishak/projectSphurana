'use client';

/**
 * `/{org}/{location}` — the location page the product owner sketched.
 *
 * Today `/sites/{org}/venue/{branch}` shows opening hours, services and team
 * with a single "Book now" card. The sketch adds three more ways to spend money
 * — a course, a gift voucher, the retail shop — and puts a special-offers
 * banner above all four.
 *
 * The button ORDER is from the sketch and is deliberately not responsive: on a
 * phone the four stack full-width, on desktop they move into the sticky card,
 * but "Make a booking" stays first and stays the only primary. Everything else
 * on the page is secondary to getting an appointment in the diary.
 */

import {
  ArrowRightIcon,
  ClockIcon,
  MailIcon,
  MapPinIcon,
  PhoneIcon,
  SparklesIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

import { LOCATIONS, SPECIAL_OFFERS } from './mock';
import { WfNote, WfPortalShell } from './wf-shell';

const LOCATION = LOCATIONS[0];

/**
 * Booking is the page's job; the other three are secondary revenue.
 *
 * So the hierarchy is explicit rather than implied by order alone: one large
 * primary button, then the other three sharing a row beneath it. Four
 * equal-weight stacked buttons made the patient read all four to find the one
 * they came for.
 */
const SECONDARY_ACTIONS = [
  { label: 'Buy a course', href: '/wireframes/courses' },
  { label: 'Buy a gift voucher', href: '/wireframes/voucher' },
  { label: 'Visit our shop', href: '/wireframes/shop' },
];

/**
 * The three secondary actions as a COLUMN.
 *
 * They were a row of three. At a phone width that gave each label about a third
 * of the screen, which fitted only because the labels are short — and it read as
 * a toolbar rather than as three things you can buy. Stacked, each one is a
 * full-width target with room for a line of detail, and the order is a
 * priority rather than a layout accident.
 */
function SecondaryActionColumn() {
  return (
    <div className="space-y-2">
      {SECONDARY_ACTIONS.map((action) => (
        <Button
          key={action.label}
          variant="outline"
          className="h-auto w-full justify-between px-4 py-3 text-left"
          asChild
        >
          <a href={action.href}>
            <span>{action.label}</span>
            <ArrowRightIcon className="size-4 opacity-60" />
          </a>
        </Button>
      ))}
    </div>
  );
}

export function LocationHome() {
  const offer = SPECIAL_OFFERS[0];

  return (
    <WfPortalShell
      actions={
        <>
          <Button variant="outline" size="sm">
            Manage bookings
          </Button>
          <Button variant="outline" size="sm">
            My account
          </Button>
        </>
      }
    >
      <WfNote>
        Static page. The gallery, header and About block reproduce the live
        venue page. The only new things are the offer strip under the photos and
        the three commerce actions — and their destinations do not exist yet.
      </WfNote>

      <div className="mx-auto max-w-6xl space-y-8 p-4 sm:p-6">
        <header className="space-y-2">
          <h1 className="font-bold text-4xl">{LOCATION.name}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground text-sm">
            <span>No reviews yet</span>
            <span>·</span>
            <span className="text-green-600">{LOCATION.statusLabel}</span>
            <span>·</span>
            <span className="flex items-center gap-1">
              <MapPinIcon className="size-4" />
              {LOCATION.address}
            </span>
            <button type="button" className="text-primary hover:underline">
              Get directions
            </button>
          </div>
        </header>

        {/*
          The gallery, as the live venue page already renders it: one large lead
          image with two stacked to its right, and a "see all" affordance. This
          is EXISTING chrome — `components/venue/venue-gallery.tsx` — reproduced
          here so the offer strip below it can be judged in place. The wireframe
          previously omitted it, which made the page look like a redesign of a
          venue page that ships.
        */}
        <div className="grid gap-2 sm:grid-cols-[2fr_1fr]">
          <div className="aspect-[4/3] rounded-xl bg-muted sm:aspect-[3/2]" />
          <div className="grid gap-2">
            <div className="hidden aspect-[3/2] rounded-xl bg-muted sm:block" />
            <div className="relative hidden aspect-[3/2] rounded-xl bg-muted sm:block">
              <Button
                variant="secondary"
                size="sm"
                className="absolute right-3 bottom-3"
              >
                See all images
              </Button>
            </div>
          </div>
        </div>

        {/*
          The offer strip — the one genuinely new thing on this page.

          It was a full card above the fold with a 2xl heading, which competed
          with the booking button for the only decision that matters. A patient
          arrives here to book; an offer is a nudge, not the headline. So it is
          one line under the photos, and it is omitted entirely when there is no
          live offer — an empty promotional slot reads as a broken page rather
          than as "no offers this month".
        */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <SparklesIcon className="size-4 shrink-0 text-primary" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{offer.title}</span>
            <span className="text-muted-foreground"> · {offer.body}</span>
          </p>
          <Button variant="link" size="sm" className="h-auto p-0">
            {offer.ctaLabel}
            <ArrowRightIcon className="size-3.5" />
          </Button>
        </div>

        <div className="grid gap-10 lg:grid-cols-[1fr_360px]">
          <div className="space-y-8">
            {/* Mobile: the actions live inline, above the fold. */}
            <div className="space-y-3 lg:hidden">
              <Button
                size="lg"
                className="h-16 w-full justify-between text-base"
              >
                Make a booking
                <ArrowRightIcon className="size-5 opacity-80" />
              </Button>
              <SecondaryActionColumn />
            </div>

            <section className="space-y-4">
              <h2 className="font-bold text-2xl">About us</h2>
              <Card>
                <CardContent className="divide-y p-0">
                  <div className="flex items-start gap-3 p-5">
                    <MapPinIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground text-sm">Find us</p>
                      <p className="font-medium">{LOCATION.address}</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-5">
                    <PhoneIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground text-sm">Call us</p>
                      <p className="font-medium">01782 555 240</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-5">
                    <MailIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground text-sm">Email us</p>
                      <p className="font-medium">hello@acmeskin.co.uk</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-5">
                    <ClockIcon className="mt-0.5 size-4 text-muted-foreground" />
                    <div>
                      <p className="text-muted-foreground text-sm">Today</p>
                      <p className="font-medium">9:00 am – 6:00 pm</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </section>
          </div>

          {/* Desktop: the same four actions, same order, in the sticky card. */}
          <aside className="hidden lg:sticky lg:top-24 lg:block lg:h-fit">
            <div className="rounded-2xl border bg-card p-6 shadow-sm">
              <p className="font-semibold">{LOCATION.name}</p>
              <p className="text-muted-foreground text-sm">No reviews yet</p>
              <Separator className="my-4" />
              <div className="space-y-3">
                <Button
                  size="lg"
                  className="h-16 w-full justify-between text-base"
                >
                  Make a booking
                  <ArrowRightIcon className="size-5 opacity-80" />
                </Button>
                <SecondaryActionColumn />
              </div>
              <Separator className="my-4" />
              <p className="flex items-center gap-2 text-green-600 text-sm">
                <ClockIcon className="size-4" />
                {LOCATION.statusLabel}
              </p>
              <p className="mt-2 flex items-start gap-2 text-muted-foreground text-sm">
                <MapPinIcon className="mt-0.5 size-4 shrink-0" />
                <span>
                  {LOCATION.address}{' '}
                  <button
                    type="button"
                    className="text-primary hover:underline"
                  >
                    Get directions
                  </button>
                </span>
              </p>
            </div>
          </aside>
        </div>
      </div>
    </WfPortalShell>
  );
}
