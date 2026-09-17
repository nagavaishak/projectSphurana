'use client';

/**
 * Courses — list, detail, and the session scheduler.
 *
 * The product owner's note on the wireframe was: "Min and Max Days between
 * sessions needs to be added to db". These three views are where that field
 * earns its keep, and it is customer-facing at every one of them:
 *
 *   list      — before anyone spends money, because a six-session laser course
 *               is a four-month commitment and that should not be a surprise
 *   detail    — with the clinical reason, so the rule reads as care rather
 *               than as an arbitrary restriction
 *   scheduler — as a hard clamp on which dates can be picked
 *
 * The MAXIMUM gap warns rather than blocks. Hard-blocking a patient who let the
 * window lapse strands money they have already paid and generates exactly the
 * phone call the portal exists to prevent.
 */

import {
  ArrowRightIcon,
  CalendarIcon,
  CheckIcon,
  InfoIcon,
  LockIcon,
  TriangleAlertIcon,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { sessionGapReason, sessionGapSentence } from './course-gap';
import { COURSES, COURSE_PURCHASE, type WfCourse } from './mock';
import { WfNote, WfPortalShell, WfSummaryCard } from './wf-shell';

/* ------------------------------------------------------------------ list -- */

export function CoursesList() {
  return (
    <WfPortalShell backLabel="Courses">
      <WfNote>
        Static page. Courses have no table, no API and no purchase flow yet —
        including the min/max session gap shown on each card.
      </WfNote>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-2">
          <h1 className="font-bold text-3xl md:text-4xl">
            Buy a course, save on every session
          </h1>
          <p className="text-muted-foreground">
            Pay once, then book each session as you go.
          </p>
        </header>

        <ul className="space-y-4">
          {COURSES.map((course) => (
            <li key={course.id}>
              <CourseCard course={course} />
            </li>
          ))}
        </ul>
      </main>
    </WfPortalShell>
  );
}

function CourseCard({ course }: { course: WfCourse }) {
  const gapSentence = sessionGapSentence(course);

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-semibold text-lg">{course.name}</p>
            <p className="text-muted-foreground text-sm">{course.category}</p>
          </div>
          {course.savingLabel ? (
            <Badge variant="secondary" className="shrink-0">
              {course.savingLabel}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="font-bold text-2xl">{course.priceLabel}</span>
          {course.wasPriceLabel ? (
            <span className="text-muted-foreground line-through">
              {course.wasPriceLabel}
            </span>
          ) : null}
        </div>

        <ul className="space-y-1.5 text-sm">
          <li className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" />
            <span>
              {course.sessionCount} sessions of {course.sessionServiceName}
            </span>
          </li>
          <li className="flex items-start gap-2">
            <CheckIcon className="mt-0.5 size-4 shrink-0 text-green-600" />
            <span>{course.validityLabel}</span>
          </li>
        </ul>

        {/*
          The gap rule, before purchase — one sentence shape, derived from the
          two ints. Its own block rather than a bullet, because it is a
          commitment rather than a feature.
        */}
        {gapSentence ? (
          <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm">
            <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{gapSentence}</span>
          </div>
        ) : null}

        <Button className="w-full" asChild>
          <a href="/wireframes/course-detail">Buy course</a>
        </Button>
      </CardContent>
    </Card>
  );
}

/* ---------------------------------------------------------------- detail -- */

export function CourseDetail() {
  const course = COURSES[0];
  const gapSentence = sessionGapSentence(course);
  const gapReason = sessionGapReason(course.serviceKind);

  return (
    <WfPortalShell backLabel="Course">
      <WfNote>
        Static page. Buying would sign the patient in, then hand off to Stripe
        Checkout — neither step is wired here.
      </WfNote>

      <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
        <div className="min-w-0 space-y-6">
          <header className="space-y-3">
            {course.savingLabel ? (
              <Badge variant="secondary">{course.savingLabel}</Badge>
            ) : null}
            <h1 className="font-bold text-3xl md:text-4xl">{course.name}</h1>
            <div className="flex items-baseline gap-3">
              <span className="font-bold text-3xl">{course.priceLabel}</span>
              {course.wasPriceLabel ? (
                <span className="text-lg text-muted-foreground line-through">
                  {course.wasPriceLabel}
                </span>
              ) : null}
            </div>
          </header>

          <Card>
            <CardContent className="divide-y p-0">
              <DetailRow
                label="What's included"
                value={`${course.sessionCount} × ${course.sessionServiceName}`}
              />
              <DetailRow label="Valid until" value={course.validityLabel} />
              <DetailRow label="Where" value="Any Acme Skin & Laser clinic" />
            </CardContent>
          </Card>

          {/*
            The same rule as the card, in its long form, with the clinical
            reason attached. A patient who understands WHY the gap exists is far
            less likely to ring up asking to be squeezed in early.
          */}
          {gapSentence ? (
            <Card className="border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
              <CardContent className="space-y-2 p-5">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Scheduling rules
                </p>
                <p className="text-amber-900/90 text-sm dark:text-amber-200/90">
                  {gapSentence}.
                </p>
                {gapReason ? (
                  <p className="text-amber-900/80 text-sm dark:text-amber-200/80">
                    {gapReason}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <section className="space-y-3">
            <h2 className="font-semibold text-lg">How it works</h2>
            <Card>
              <CardContent className="divide-y p-0">
                <HowStep n={1} text="Buy the course" />
                <HowStep n={2} text="Book your first session" />
                <HowStep n={3} text="We remind you when the next one is due" />
              </CardContent>
            </Card>
          </section>
        </div>

        <aside>
          <WfSummaryCard>
            <p className="font-semibold">{course.name}</p>
            <p className="text-muted-foreground text-sm">
              {course.sessionCount} sessions
            </p>
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <span className="font-semibold">Total</span>
              <span className="font-semibold">{course.priceLabel}</span>
            </div>
            {course.savingLabel ? (
              <p className="mt-1 text-green-600 text-sm">
                {course.savingLabel} against booking individually
              </p>
            ) : null}
            <Button className="mt-4 w-full" size="lg">
              Buy this course
              <ArrowRightIcon className="size-4" />
            </Button>
            <p className="mt-3 text-center text-muted-foreground text-xs">
              You'll be asked to sign in, then taken to secure payment.
            </p>
          </WfSummaryCard>
        </aside>
      </main>
    </WfPortalShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-5">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-0.5 font-medium">{value}</p>
    </div>
  );
}

function HowStep({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-center gap-3 p-4">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/10 font-semibold text-primary text-sm">
        {n}
      </span>
      <span className="font-medium">{text}</span>
    </div>
  );
}

/* ------------------------------------------------------------- scheduler -- */

export function CourseScheduler() {
  const { course, sessions, sessionsUsed, expiresLabel } = COURSE_PURCHASE;

  return (
    <WfPortalShell backLabel="My course">
      <WfNote>
        Static page. The bookable window on session 4 is what the min/max gap
        field produces — the date picker behind "Book session 4" would be
        clamped to it.
      </WfNote>

      <main className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6">
        <header className="space-y-3">
          <h1 className="font-bold text-2xl md:text-3xl">{course.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {sessionsUsed} of {course.sessionCount} used
            </Badge>
            <Badge variant="outline">Expires {expiresLabel}</Badge>
          </div>
          {/*
            <progress> carries the semantics natively, so it needs no role and
            no aria-value* triplet — and unlike a div with role="progressbar" it
            is reachable by assistive tech without being made focusable.
          */}
          <progress
            className="block h-1.5 w-full overflow-hidden rounded-full bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
            value={sessionsUsed}
            max={course.sessionCount}
            aria-label="Sessions used"
          />
        </header>

        <section className="space-y-3">
          <h2 className="font-semibold text-lg">Your sessions</h2>
          <Card>
            <CardContent className="divide-y p-0">
              {sessions.map((session) => (
                <SessionRow key={session.index} session={session} />
              ))}
            </CardContent>
          </Card>
        </section>

        {/*
          The missed-window state. Shown here as a static example of the copy;
          in the real page it replaces the bookable row once
          `now > last_session + max_days`.
        */}
        <Card className="border-amber-500/30 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="flex items-start gap-3 p-5">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div className="space-y-2">
              <p className="font-semibold text-amber-900 dark:text-amber-200">
                If the window is missed
              </p>
              <p className="text-amber-900/90 text-sm dark:text-amber-200/90">
                It's been longer than recommended between sessions. Your clinic
                may want to reassess before continuing — but the session is
                still yours.
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button variant="outline" size="sm">
                  Book anyway
                </Button>
                <Button variant="ghost" size="sm">
                  Call the clinic
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </main>
    </WfPortalShell>
  );
}

function SessionRow({
  session,
}: {
  session: (typeof COURSE_PURCHASE)['sessions'][number];
}) {
  const isLocked = session.state === 'locked';

  return (
    <div className={cn('flex gap-3 p-5', isLocked && 'opacity-50')}>
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-sm',
          session.state === 'completed' && 'bg-green-100 text-green-700',
          session.state === 'booked' && 'bg-primary text-primary-foreground',
          session.state === 'bookable' && 'bg-muted text-foreground',
          isLocked && 'bg-muted text-muted-foreground'
        )}
      >
        {session.state === 'completed' ? (
          <CheckIcon className="size-4" />
        ) : isLocked ? (
          <LockIcon className="size-3.5" />
        ) : (
          session.index
        )}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium">Session {session.index}</p>
          {session.state === 'completed' ? (
            <Badge variant="secondary">Done</Badge>
          ) : null}
          {session.state === 'booked' ? <Badge>Booked</Badge> : null}
        </div>

        {session.whenLabel ? (
          <p className="text-muted-foreground text-sm">
            {session.whenLabel}
            {session.practitioner ? ` · ${session.practitioner}` : ''}
          </p>
        ) : null}

        {/* The clamped window — the whole reason the field exists. */}
        {session.windowLabel ? (
          <p className="flex items-center gap-1.5 font-medium text-primary text-sm">
            <CalendarIcon className="size-3.5" />
            Bookable {session.windowLabel}
          </p>
        ) : null}

        {session.lockReason ? (
          <p className="text-muted-foreground text-sm">{session.lockReason}</p>
        ) : null}

        {session.state === 'booked' ? (
          <div className="pt-1">
            <Button variant="outline" size="sm">
              Reschedule
            </Button>
          </div>
        ) : null}

        {session.state === 'bookable' ? (
          <div className="pt-2">
            <Button size="sm">Book session {session.index}</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
