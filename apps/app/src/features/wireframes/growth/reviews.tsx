'use client';

/**
 * §16 — review management.
 *
 * ## The job is the unhappy patient, so she is the page
 *
 * The first version opened with four metric tiles and a rating histogram, and
 * put the negative feedback below them. That is the wrong way round: nobody
 * opens this page to learn the average is 4.6. They open it because someone
 * rated a visit 2 and is waiting for a call.
 *
 * So the page opens on three cards — one per unhappy patient — with the words
 * she actually wrote at full size. The counts moved into the sentence under the
 * title, where they are context rather than a wall.
 *
 * ## The Google number is clicks, not reviews
 *
 * §5.7's integration is a pasted link. We can count who was sent it and who
 * tapped it; we cannot see what they posted. The copy says "asked" and
 * "opened", never "left us a review", because the first owner to reconcile this
 * against their Google page and find it wrong stops trusting every other number
 * here.
 */

import { StarIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  ALL_RESPONSES,
  GOOGLE_CLICKS,
  NEGATIVE_FEEDBACK,
  RATING_DISTRIBUTION,
  REVIEW_PROMPT,
  REVIEW_ROUTE_HIGH,
  REVIEW_ROUTE_LOW,
  REVIEW_ROUTE_MID,
} from './mock';

type ViewId = 'feedback' | 'responses' | 'flow';

const VIEWS = [
  { id: 'feedback', label: 'Needs a reply' },
  { id: 'responses', label: 'All responses' },
  { id: 'flow', label: 'What Claire asks' },
];

const TOTAL_RESPONSES = RATING_DISTRIBUTION.reduce(
  (sum, bucket) => sum + bucket.count,
  0
);

export function WfReviews() {
  const [view, setView] = useState<ViewId>('feedback');

  return (
    <WfFrame
      name="Reviews"
      location="Growth › Reviews"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="Negative feedback is the page, not a section of it">
            An owner opens this because somebody is unhappy. Metric tiles above
            the complaint made the complaint the thing you scroll to.
          </WfPoint>
          <WfPoint title="The quote is not truncated">
            “I waited 35 minutes and nobody told me why” is the whole point of
            collecting it. Two lines and an ellipsis turns the page into an
            index of things to go and read somewhere else.
          </WfPoint>
          <WfPoint title="Google is clicks, and the copy says so">
            The integration is a pasted link (§5.7). We know who was asked and
            who tapped; we cannot see what was posted. “9 asked · 6 opened the
            link” is true. “6 reviews” is not.
          </WfPoint>
          <WfPoint title="The routing messages are one screen">
            Four bodies of copy that only exist to be read together — the ask
            and its three branches. Inline they crowded out the feedback; behind
            a state they read as the conversation they are.
          </WfPoint>
          <WfPoint title="Missing rule">
            A patient having a facial every 28 days must not be asked to rate
            every visit. §27 needs a suppression window before this ships.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Reviews"
        description={`${TOTAL_RESPONSES} responses in the last three months · 4.6 average · 9 patients asked to review on Google, 6 opened the link.`}
      >
        {view === 'feedback' ? <Feedback /> : null}
        {view === 'responses' ? <Responses /> : null}
        {view === 'flow' ? <Flow /> : null}
      </DashboardPage>
    </WfFrame>
  );
}

/* -------------------------------------------------------------- feedback -- */

function Feedback() {
  return (
    <div className="space-y-4">
      {NEGATIVE_FEEDBACK.map((card) => (
        <div
          key={card.id}
          className={cn(
            'rounded-xl border p-5',
            // Only the unhandled ones carry weight. A resolved complaint is
            // history, and colouring it the same keeps the page shouting.
            card.status === 'open' ? 'border-destructive/40 bg-card' : 'bg-card'
          )}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{card.name}</p>
              <p className="text-muted-foreground text-sm">
                {card.treatment} · {card.practitioner} · {card.visit}
              </p>
            </div>
            <Stars rating={card.rating} />
          </div>

          <p className="mt-4 text-[15px] leading-relaxed">{card.feedback}</p>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            {card.status === 'open' ? (
              <>
                <Button size="sm">Call her</Button>
                <Button size="sm" variant="outline">
                  Assign
                </Button>
              </>
            ) : (
              <Badge variant="secondary">
                {card.status === 'assigned'
                  ? `Assigned to ${card.assignee}`
                  : `Resolved by ${card.assignee}`}
              </Badge>
            )}
            <Button size="sm" variant="ghost">
              Open her record
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- responses -- */

function Responses() {
  const max = Math.max(...RATING_DISTRIBUTION.map((bucket) => bucket.count));

  return (
    <div className="space-y-6">
      {/* Five rows, no chart library. A distribution this small is a list. */}
      <div className="space-y-1.5 rounded-xl border p-5">
        {RATING_DISTRIBUTION.map((bucket) => (
          <div key={bucket.rating} className="flex items-center gap-3 text-sm">
            <span className="w-4 tabular-nums">{bucket.rating}</span>
            <StarIcon className="size-3.5 fill-amber-400 text-amber-400" />
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-primary"
                style={{ width: `${(bucket.count / max) * 100}%` }}
              />
            </span>
            <span className="w-8 text-right tabular-nums">{bucket.count}</span>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead className="w-[90px]">Rating</TableHead>
              <TableHead>Treatment</TableHead>
              <TableHead>What happened</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ALL_RESPONSES.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  {row.name}
                  <span className="block font-normal text-muted-foreground text-xs">
                    {row.when}
                  </span>
                </TableCell>
                <TableCell className="tabular-nums">{row.rating}/5</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.treatment}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {row.routedTo}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <p className="text-muted-foreground text-sm">
        {GOOGLE_CLICKS.filter((row) => row.clicked !== 'Not yet').length} of{' '}
        {GOOGLE_CLICKS.length} patients sent a Google link opened it. Whether
        they posted anything is not something Google tells us.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ flow -- */

function Flow() {
  return (
    <div className="max-w-2xl space-y-6">
      <Bubble label="48 hours after the visit" body={REVIEW_PROMPT} />
      <div className="space-y-4 border-l pl-5">
        <Bubble label="She replies 4 or 5" body={REVIEW_ROUTE_HIGH} />
        <Bubble label="She replies 3" body={REVIEW_ROUTE_MID} />
        <Bubble label="She replies 1 or 2" body={REVIEW_ROUTE_LOW} />
      </div>
      <p className="text-muted-foreground text-sm">
        Anything under 4 also notifies the owner, creates a follow-up task and
        flags the patient record. That is what puts the cards on the first
        screen.
      </p>
    </div>
  );
}

function Bubble({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <p className="font-medium text-muted-foreground text-sm">{label}</p>
      <div className="mt-1.5 max-w-[420px] rounded-2xl rounded-bl-sm border bg-card p-4 text-sm leading-relaxed">
        {body}
      </div>
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  return (
    <span
      className="flex items-center gap-0.5"
      aria-label={`${rating} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((value) => (
        <StarIcon
          key={value}
          className={cn(
            'size-4',
            value <= rating
              ? 'fill-amber-400 text-amber-400'
              : 'text-muted-foreground/30'
          )}
        />
      ))}
    </span>
  );
}
