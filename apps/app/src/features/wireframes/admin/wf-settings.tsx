'use client';

/**
 * §5 — clinic settings.
 *
 * ## A rail and one page, not ten pages stacked
 *
 * The first version rendered every settings area down one scroll with a
 * build-state badge beside each heading. That is a project tracker, not a
 * settings screen: the badges are information about US, and an owner setting up
 * a clinic has no use for them. They are in the notes drawer instead.
 *
 * What is left is the shape the real product needs — a persistent rail, one
 * section of fields at a time, and a save bar that belongs to that section.
 * Trading hours and the booking page have their own save semantics, so a single
 * page-wide "Save all settings" would be a lie.
 *
 * Two sections are built out properly. The rest are named and reachable and say
 * what they contain, because the rail's job is to show the whole surface even
 * when only part of it has been designed.
 */

import { type ReactNode, useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { BOOKING_THEMES, SETTINGS_NAV } from './mock';

export function WfSettings() {
  const [section, setSection] = useState('business-profile');

  const current =
    SETTINGS_NAV.find((item) => item.id === section) ?? SETTINGS_NAV[0];

  return (
    <WfFrame
      name="Settings"
      location="Settings"
      notes={
        <>
          <WfPoint title="Build-state badges left the canvas">
            “Built / partial / missing” is information about the engineering
            backlog. On the screen it made a clinic’s own settings look like a
            product roadmap. The gaps are: three care fields on the service
            menu, the practitioner hours editor and bio, product type/unit/lot,
            the Google review link, and Data &amp; privacy in full.
          </WfPoint>
          <WfPoint title="Save belongs to the section, not the page">
            Trading hours saves a seven-row grid; the booking page publishes to
            a public URL. One page-level save button over both would either save
            too much or claim to have saved something it did not.
          </WfPoint>
          <WfPoint title="The rail shows everything, including what is not built">
            An owner needs to know where deposits live even on a day we have not
            finished them. Hiding unbuilt sections makes the product look
            smaller than it is and hides the ones we owe.
          </WfPoint>
          <WfPoint title="The booking URL is shown, not just editable">
            It is the thing the clinic pastes into Instagram. Seeing the whole
            address, with a copy control, is most of what anyone opens this
            section for.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Settings"
        description="Harley Aesthetics · 2 locations · 5 team members"
      >
        <div className="grid gap-8 md:grid-cols-[220px_1fr]">
          <nav className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
            {SETTINGS_NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSection(item.id)}
                className={cn(
                  'whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors',
                  item.id === section
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground hover:bg-muted/50'
                )}
              >
                {item.label}
              </button>
            ))}
          </nav>

          <div>
            {section === 'business-profile' ? <BusinessProfile /> : null}
            {section === 'booking-page' ? <BookingPage /> : null}
            {section !== 'business-profile' && section !== 'booking-page' ? (
              <div className="rounded-xl border p-8">
                <h2 className="font-semibold text-lg">{current.label}</h2>
                <p className="mt-1 max-w-md text-muted-foreground text-sm">
                  {current.blurb}
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </DashboardPage>
    </WfFrame>
  );
}

/* ------------------------------------------------------ business profile -- */

function BusinessProfile() {
  return (
    <SettingsSection
      title="Business profile"
      description="What patients see on the booking page, receipts and reminder messages."
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Clinic name" id="clinic-name">
          <Input id="clinic-name" defaultValue="Harley Aesthetics" />
        </Field>
        <Field label="Phone" id="clinic-phone">
          <Input id="clinic-phone" defaultValue="020 7946 0912" />
        </Field>
        <Field label="Email" id="clinic-email">
          <Input
            id="clinic-email"
            defaultValue="hello@harleyaesthetics.co.uk"
          />
        </Field>
        <Field label="Time zone" id="clinic-tz">
          <Select defaultValue="Europe/London">
            <SelectTrigger id="clinic-tz" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Europe/London">Europe/London (BST)</SelectItem>
              <SelectItem value="Europe/Dublin">Europe/Dublin (IST)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Address" id="clinic-address">
        <Textarea
          id="clinic-address"
          rows={3}
          defaultValue={'14 Harley Street\nMarylebone\nLondon W1G 9PQ'}
        />
      </Field>

      {/* Currency is set once and then locked by the first invoice. Saying so
          beside the control is cheaper than explaining it in support later. */}
      <Field label="Currency" id="clinic-currency">
        <div className="flex flex-wrap items-center gap-3">
          <Select defaultValue="GBP">
            <SelectTrigger id="clinic-currency" className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="GBP">£ GBP</SelectItem>
              <SelectItem value="EUR">€ EUR</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-muted-foreground text-sm">
            Locked once the first invoice is issued.
          </span>
        </div>
      </Field>
    </SettingsSection>
  );
}

/* ---------------------------------------------------------- booking page -- */

function BookingPage() {
  return (
    <SettingsSection
      title="Booking page"
      description="The public page patients book on."
    >
      <Field label="Address" id="booking-url">
        <div className="flex gap-2">
          <Input
            id="booking-url"
            readOnly
            defaultValue="borradh.io/harley-aesthetics"
          />
          <Button variant="outline">Copy</Button>
          <Button variant="outline">Open</Button>
        </div>
      </Field>

      <div className="space-y-2">
        <p className="font-medium text-sm">Colour</p>
        <div className="flex flex-wrap gap-2">
          {BOOKING_THEMES.map((theme, index) => (
            <button
              key={theme.id}
              type="button"
              aria-pressed={index === 1}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm',
                index === 1 && 'border-primary ring-1 ring-primary'
              )}
            >
              <span className={cn('size-4 rounded-full', theme.swatch)} />
              {theme.label}
            </button>
          ))}
        </div>
      </div>

      <Field label="Welcome message" id="booking-welcome">
        <Textarea
          id="booking-welcome"
          rows={3}
          defaultValue="Welcome to Harley Aesthetics. Choose a treatment below and we'll show you the next available times with your practitioner."
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Gap between bookings" id="booking-buffer">
          <Select defaultValue="15">
            <SelectTrigger id="booking-buffer" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">None</SelectItem>
              <SelectItem value="15">15 minutes</SelectItem>
              <SelectItem value="30">30 minutes</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="How far ahead patients can book" id="booking-advance">
          <Select defaultValue="90">
            <SelectTrigger id="booking-advance" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="180">6 months</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3.5">
        <div>
          <p className="font-medium text-sm">Show prices</p>
          <p className="text-muted-foreground text-sm">
            Off shows “from £160” instead of the exact price.
          </p>
        </div>
        <Switch defaultChecked aria-label="Show prices" />
      </div>
    </SettingsSection>
  );
}

/* ---------------------------------------------------------------- shared -- */

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-6">
      <div>
        <h2 className="font-semibold text-lg">{title}</h2>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>

      {children}

      {/* Section-scoped, because these sections do not save together. */}
      <div className="flex gap-2 border-t pt-5">
        <Button>Save changes</Button>
        <Button variant="ghost">Discard</Button>
      </div>
    </section>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
