'use client';

/**
 * `/{org}` — the multi-location landing page from the sketch.
 *
 * A chooser already exists (`components/booking/location-chooser.astro`) and it
 * does one thing: pick a branch, go into that branch. The sketch adds a second
 * job — courses, vouchers and the shop are sold at ORG level, so they belong
 * here as well as on each location page.
 *
 * A single-location org must never reach this page. Being asked to choose
 * between one option reads as a broken page, so `/sites/{org}/venue` already
 * 302s in that case and this surface inherits the same rule.
 */

import { ArrowRightIcon, MapPinIcon, PhoneIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

import { LOCATIONS, ORG, type WfLocation } from './mock';
import { WfNote, WfPortalShell } from './wf-shell';

const ORG_ACTIONS = [
  {
    label: 'Buy a course',
    hint: 'Save up to 25% on multi-session treatments',
    href: '/wireframes/courses',
  },
  {
    label: 'Buy a gift voucher',
    hint: 'Delivered by email, instantly or on a date you choose',
    href: '/wireframes/voucher',
  },
  {
    label: 'Visit our shop',
    hint: 'Medical-grade skincare, collect or delivered',
    href: '/wireframes/shop',
  },
];

export function OrgLanding() {
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
        Static page. The location cards mirror the live chooser; the three
        org-level actions below them are new.
      </WfNote>

      <main className="mx-auto max-w-5xl space-y-10 px-4 py-10 sm:px-6">
        <header className="space-y-3">
          <h1 className="font-bold text-4xl">{ORG.name}</h1>
          <p className="max-w-prose text-muted-foreground">
            Medical aesthetics across Staffordshire and Cheshire. Book with our
            doctors and aesthetic nurses in under a minute.
          </p>
        </header>

        <section className="space-y-4">
          <h2 className="font-semibold text-xl">Choose a location</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {LOCATIONS.map((location) => (
              <li key={location.id}>
                <LocationCard location={location} />
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="font-semibold text-xl">Also available</h2>
          <ul className="grid gap-3 sm:grid-cols-3">
            {ORG_ACTIONS.map((action) => (
              <li key={action.label}>
                <a
                  href={action.href}
                  className="flex h-full flex-col gap-1 rounded-xl border p-5 transition-colors hover:bg-muted/50"
                >
                  <span className="flex items-center justify-between gap-2 font-medium">
                    {action.label}
                    <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                  </span>
                  <span className="text-muted-foreground text-sm">
                    {action.hint}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </WfPortalShell>
  );
}

function LocationCard({ location }: { location: WfLocation }) {
  const bookable = location.status !== 'phone-only';

  return (
    <Card className="h-full overflow-hidden py-0">
      <div className="aspect-[5/2] bg-muted" />
      <CardContent className="space-y-3 p-5">
        <div className="space-y-1">
          <p className="font-semibold">{location.name}</p>
          <p className="flex items-start gap-1.5 text-muted-foreground text-sm">
            <MapPinIcon className="mt-0.5 size-3.5 shrink-0" />
            {location.address}
          </p>
        </div>

        <p
          className={cn(
            'text-sm',
            location.status === 'open' && 'text-green-600',
            location.status === 'closed' && 'text-orange-600',
            location.status === 'phone-only' && 'text-muted-foreground'
          )}
        >
          {location.statusLabel}
        </p>

        {bookable ? (
          <Button variant="outline" className="w-full" asChild>
            <a href="/wireframes/location">
              View & book
              <ArrowRightIcon className="size-4" />
            </a>
          </Button>
        ) : (
          /*
            A branch that does not take online bookings is a real state and must
            not render a button that leads nowhere. It gets a phone link and a
            badge saying why.
          */
          <>
            <Badge variant="secondary">Phone bookings only</Badge>
            <Button variant="outline" className="w-full" asChild>
              <a href={`tel:${location.phone?.replace(/\s/g, '')}`}>
                <PhoneIcon className="size-4" />
                {location.phone}
              </a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
