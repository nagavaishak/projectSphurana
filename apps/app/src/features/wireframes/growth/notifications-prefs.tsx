'use client';

/**
 * §15.2–§15.4 — the notification categories the new features need.
 *
 * ## The correction that produced this screen
 *
 * The first version proposed a matrix: twenty-nine event types down the side,
 * two channels across, one category shown at a time. It was drawn without
 * reading `settings/notifications`, which already ships — and which is
 * deliberately the opposite. Four categories, each with a SCOPE (Only mine /
 * Everyone / Off) and per-channel toggles beneath. Twelve controls, not
 * fifty-eight.
 *
 * The scope select is the idea the matrix would have destroyed. "Appointments:
 * only mine" is one decision that answers twenty questions, and a practitioner
 * in a six-chair clinic makes it once. A matrix cannot express it at all — it
 * would force every practitioner to reason about every event type, and it would
 * still not let them say "mine".
 *
 * So the delta is five more rows in the existing idiom, and one new digest.
 *
 * ## Why these four and not more
 *
 * Each is an event the clinic must ACT on and cannot currently hear about: an
 * order waiting to be picked, money kept or lost, a signature about to lapse, a
 * public review, a vial about to run out. Events that merely record something
 * already reachable in a list do not earn a row.
 *
 * ## Orders is the only row that is BOTH channels by default
 *
 * An online order is the one event here with a person waiting at the other end
 * of it — somebody has paid and expects to collect. It is also the only one
 * that creates physical work: a jar has to come off a shelf and go in a bag. A
 * till sale earns no notification, because the person who made it was standing
 * there.
 *
 * ## Payments has no scope
 *
 * Money is not "mine" or "everyone" — a forfeited deposit belongs to the
 * business, not to whoever was holding the appointment. So it renders as a
 * plain on/off, which is the shape the live page already uses for Advertising.
 */

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

import { WfFrame, WfPoint } from '../wf-frame';

/** Reproduced from the live page, inert — context for where the new rows land. */
const EXISTING = ['Appointments', 'Inbox handoffs', 'New leads', 'Advertising'];

interface NewRow {
  label: string;
  description: string;
  scoped: boolean;
  email: boolean;
  push: boolean;
}

const NEW_ROWS: NewRow[] = [
  {
    label: 'Orders',
    description:
      'An online order is paid and needs picking, or a customer has collected one.',
    scoped: false,
    email: true,
    push: true,
  },
  {
    label: 'Payments & deposits',
    description:
      'A deposit is forfeited, a refund fails, or a card is declined at checkout.',
    scoped: false,
    email: true,
    push: false,
  },
  {
    label: 'Consent',
    description: 'A signed form is within 30 days of lapsing.',
    scoped: true,
    email: true,
    push: false,
  },
  {
    label: 'Reviews',
    description: 'A patient leaves a public review.',
    scoped: true,
    email: false,
    push: true,
  },
  {
    label: 'Stock',
    description: 'A product crosses its low-stock level.',
    scoped: false,
    email: true,
    push: false,
  },
];

export function WfNotificationPrefs() {
  return (
    <WfFrame
      name="Notification categories"
      location="Settings › Notifications (existing page)"
      notes={
        <>
          <WfPoint title="The page already exists and is better than a matrix">
            Four categories with a scope select, not twenty-nine rows of
            switches. “Appointments: only mine” answers twenty questions with
            one control; a matrix cannot say “mine” at all.
          </WfPoint>
          <WfPoint title="Four rows added, nothing changed">
            The existing four are drawn greyed as context. Every new row uses
            the same scope-plus-channels shape, so this needs no new component.
          </WfPoint>
          <WfPoint title="Money is not scoped">
            A forfeited deposit belongs to the business, not to whoever held the
            appointment, so Payments is a plain on/off — the shape Advertising
            already uses.
          </WfPoint>
          <WfPoint title="Orders alert on both channels">
            The only event here with someone waiting at the other end, and the
            only one that creates physical work — a jar off a shelf and into a
            bag. A till sale gets nothing: the person who made it was standing
            there.
          </WfPoint>
          <WfPoint title="Reviews default to push, not email">
            A bad review is worth interrupting someone for; it is also the one
            event here with a time limit on a good reply.
          </WfPoint>
          <WfPoint title="A daily digest is the alternative to per-event noise">
            The live page has a weekly digest only. Clinics running deposits
            will want one morning summary rather than four alerts a day.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Notifications"
        description="Choose which events reach you and how they're delivered."
      >
        <div className="max-w-[960px] space-y-6">
          <Card className="gap-0 py-0">
            <CardHeader className="px-6 pt-6 pb-2">
              <CardTitle>Notifications</CardTitle>
              <CardDescription>
                Choose which events reach you and how they&apos;re delivered.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pt-2 pb-2">
              {/* Existing rows — inert context. */}
              {EXISTING.map((label) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-4 border-border border-b py-4 opacity-50"
                >
                  <Label className="font-medium text-sm">{label}</Label>
                  <div className="w-[130px] rounded-md border px-3 py-1.5 text-muted-foreground text-sm">
                    Only mine
                  </div>
                </div>
              ))}

              {NEW_ROWS.map((row, i) => (
                <NewCategoryRow
                  key={row.label}
                  row={row}
                  last={i === NEW_ROWS.length - 1}
                />
              ))}
            </CardContent>
          </Card>

          <Card className="gap-0 py-0">
            <CardHeader className="px-6 pt-6 pb-2">
              <CardTitle>Marketing &amp; updates</CardTitle>
              <CardDescription>
                Product news and summaries — not tied to your account activity.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-6 pt-2 pb-2">
              <div className="flex items-start justify-between gap-4 border-border border-b py-4 opacity-50">
                <div>
                  <p className="font-medium text-sm">Weekly digest</p>
                  <p className="text-muted-foreground text-sm">
                    A Monday summary of bookings, leads, and Claire activity.
                  </p>
                </div>
                <Switch defaultChecked />
              </div>

              <div className="flex items-start justify-between gap-4 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-sm">Daily digest</p>
                    <Badge variant="outline" className="border-primary/40">
                      New
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-sm">
                    One 7am summary of yesterday&apos;s deposits, today&apos;s
                    consent lapses and anything low on stock.
                  </p>
                </div>
                <Switch />
              </div>
            </CardContent>
          </Card>
        </div>
      </DashboardPage>
    </WfFrame>
  );
}

function NewCategoryRow({ row, last }: { row: NewRow; last: boolean }) {
  return (
    <div className={last ? 'py-4' : 'border-border border-b py-4'}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Label className="font-medium text-sm">{row.label}</Label>
            <Badge variant="outline" className="border-primary/40">
              New
            </Badge>
          </div>
          <p className="mt-0.5 text-muted-foreground text-sm">
            {row.description}
          </p>
        </div>

        {row.scoped ? (
          <Select defaultValue="all">
            <SelectTrigger size="sm" className="w-[130px] shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="mine">Only mine</SelectItem>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="off">Off</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <Switch defaultChecked className="shrink-0" />
        )}
      </div>

      <div className="mt-3 space-y-2">
        <ChannelLine label="Email" on={row.email} />
        <ChannelLine label="Push" on={row.push} />
      </div>
    </div>
  );
}

function ChannelLine({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground text-sm">{label}</span>
      <Switch defaultChecked={on} />
    </div>
  );
}
