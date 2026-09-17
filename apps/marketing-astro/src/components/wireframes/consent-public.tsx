'use client';

/**
 * The public tokenised consent form — §23.10. Route `/consent/{token}`.
 *
 * WHY THE ROUTE SITS OUTSIDE THE ORG SLUG AND OUTSIDE THE SIGNED-IN AREA.
 * §17.1 delivers this link by WhatsApp. The patient opens it from a message,
 * on a phone, often in WhatsApp's own in-app browser, and frequently before
 * they have ever had an account with the clinic. Any route that needs a slug
 * resolved or a session established turns a one-tap job into a sign-in flow at
 * the exact moment the clinic needs the form back. The token carries the
 * identity instead: single-patient, single-form, time-limited, revoked on
 * submit — and because it identifies one form for one person, the page must
 * never render anything else about them.
 *
 * WHY ONE SECTION PER SCREEN.
 * A four-section medical form on a phone is a scroll with no visible end.
 * Paging it makes progress legible and lets the save happen at a section
 * boundary, so "save and finish later" resumes somewhere meaningful rather
 * than mid-question.
 */

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  FileTextIcon,
  LinkIcon,
  PenLineIcon,
  RotateCcwIcon,
  SendIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { CONSENT_FORM, CONSENT_STATES, ORG, type WfConsentField } from './mock';
import { WfNote } from './wf-shell';

type PreviewState =
  | 'form'
  | 'renewal'
  | 'invalid'
  | 'expired'
  | 'submitted'
  | 'saved';

const PREVIEWS: [PreviewState, string][] = [
  ['form', 'Fill it in'],
  ['renewal', 'Annual renewal'],
  ['saved', 'Saved for later'],
  ['invalid', 'Invalid token'],
  ['expired', 'Expired'],
  ['submitted', 'Already submitted'],
];

export function PublicConsentForm() {
  const [preview, setPreview] = useState<PreviewState>('form');

  return (
    <div className="min-h-screen bg-muted/30">
      <ConsentHeader />

      <WfNote>
        Static page. Nothing is saved, the signature pad does not capture
        strokes, and no PDF exists. The URL shape it stands in for is{' '}
        <code className="font-mono">/consent/{'{token}'}</code> — no org slug,
        no sign-in.
      </WfNote>

      <main className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Review affordance only — not part of the design. */}
        <div className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-dashed p-3">
          <span className="text-muted-foreground text-sm">Preview:</span>
          {PREVIEWS.map(([value, label]) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={preview === value ? 'default' : 'outline'}
              onClick={() => setPreview(value)}
            >
              {label}
            </Button>
          ))}
        </div>

        {preview === 'form' ? <ConsentWizard isRenewal={false} /> : null}
        {preview === 'renewal' ? <ConsentWizard isRenewal={true} /> : null}
        {preview === 'saved' ? <SavedState /> : null}
        {preview === 'invalid' ? <InvalidTokenState /> : null}
        {preview === 'expired' ? <ExpiredState /> : null}
        {preview === 'submitted' ? <SubmittedState /> : null}
      </main>
    </div>
  );
}

function ConsentHeader() {
  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-xl items-center gap-3 px-4 py-3.5 sm:px-6">
        <span className="flex size-7 items-center justify-center rounded-md bg-primary font-semibold text-[11px] text-primary-foreground">
          {ORG.logoInitials}
        </span>
        <span className="truncate font-semibold">{ORG.name}</span>
        {/*
          No account controls, no navigation. The token grants exactly one
          thing, and a header link to "my bookings" would imply otherwise.
        */}
      </div>
    </header>
  );
}

/* ----------------------------------------------------------------- form -- */

function ConsentWizard({ isRenewal }: { isRenewal: boolean }) {
  const sections = CONSENT_FORM.sections;
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, 'yes' | 'no'>>({});
  const [scrolledToEnd, setScrolledToEnd] = useState(false);
  const [signed, setSigned] = useState(false);

  const section = sections[index];
  const isLast = index === sections.length - 1;
  const total = sections.length + 1; // + the legal/signature screen
  const stepNumber = index + 1;

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{CONSENT_FORM.formName}</Badge>
          {isRenewal ? <Badge variant="outline">Annual renewal</Badge> : null}
        </div>
        <h1 className="font-bold text-2xl">
          Hi {CONSENT_FORM.patientFirstName}
        </h1>
        <p className="text-muted-foreground text-sm">
          {CONSENT_FORM.forBookingLabel}
        </p>
      </header>

      {/*
        The renewal notice sits above the questions, not inside them. A patient
        who does not know their old answers are already in the boxes will retype
        them from memory — and a retyped medical history is a worse record than
        a reviewed one.
      */}
      {isRenewal ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-start gap-3 p-4">
            <RotateCcwIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="space-y-1">
              <p className="font-medium text-sm">
                We've filled this in from last year
              </p>
              <p className="text-muted-foreground text-sm">
                {CONSENT_STATES.renewalOfLabel}. Change anything that's no
                longer true — if nothing has, skip straight to signing.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <ProgressBar
        value={stepNumber}
        max={total}
        label={`Step ${stepNumber} of ${total}`}
      />

      {/* One section per screen. */}
      <Card>
        <CardContent className="space-y-5 p-5">
          <div className="space-y-1">
            <h2 className="font-semibold text-lg">{section.title}</h2>
            {section.blurb ? (
              <p className="text-muted-foreground text-sm">{section.blurb}</p>
            ) : null}
          </div>

          {section.fields.map((field) => (
            <ConsentFieldView
              key={field.id}
              field={field}
              isRenewal={isRenewal}
              answer={answers[field.id]}
              onAnswer={(value) =>
                setAnswers((prev) => ({ ...prev, [field.id]: value }))
              }
            />
          ))}
        </CardContent>
      </Card>

      {/* The legal text + signature screen, shown once past the last section. */}
      {isLast ? (
        <>
          <LegalScrollToAccept
            accepted={scrolledToEnd}
            onAccept={setScrolledToEnd}
          />
          <SignaturePad signed={signed} onSign={setSigned} />
        </>
      ) : null}

      <div className="flex gap-3">
        {index > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => setIndex((i) => i - 1)}
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
        ) : null}
        {isLast ? (
          <Button
            type="button"
            className="flex-1"
            size="lg"
            disabled={!(scrolledToEnd && signed)}
          >
            <CheckIcon className="size-4" />
            Submit consent
          </Button>
        ) : (
          <Button
            type="button"
            className="flex-1"
            size="lg"
            onClick={() => setIndex((i) => i + 1)}
          >
            Continue
            <ArrowRightIcon className="size-4" />
          </Button>
        )}
      </div>

      {/*
        Save-and-finish-later resumes through the SAME token, so there is
        nothing to remember and nothing to log in to. The alternative — losing
        four sections of medical history because a call came in — is the single
        most common way these forms go uncompleted.
      */}
      <div className="text-center">
        <button
          type="button"
          className="font-medium text-primary text-sm hover:underline"
        >
          Save and finish later
        </button>
        <p className="mt-1 text-muted-foreground text-xs">
          Your answers stay on this link. {CONSENT_FORM.expiresLabel}.
        </p>
      </div>
    </div>
  );
}

function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {Math.round((value / max) * 100)}%
        </span>
      </div>
      {/* <progress> carries the semantics natively — no role, no aria triplet. */}
      <progress
        className="block h-1.5 w-full overflow-hidden rounded-full bg-muted [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-primary [&::-moz-progress-bar]:bg-primary"
        value={value}
        max={max}
        aria-label={label}
      />
    </div>
  );
}

function ConsentFieldView({
  field,
  isRenewal,
  answer,
  onAnswer,
}: {
  field: WfConsentField;
  isRenewal: boolean;
  answer?: 'yes' | 'no';
  onAnswer: (value: 'yes' | 'no') => void;
}) {
  /* Last year's answers, pre-filled on renewal. */
  const prefill = isRenewal ? field.placeholder : undefined;

  if (field.kind === 'yes-no') {
    return (
      <fieldset className="space-y-2">
        <legend className="font-medium text-sm">{field.label}</legend>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={answer === 'yes' ? 'default' : 'outline'}
            onClick={() => onAnswer('yes')}
          >
            Yes
          </Button>
          <Button
            type="button"
            variant={answer === 'no' ? 'default' : 'outline'}
            onClick={() => onAnswer('no')}
          >
            No
          </Button>
        </div>

        {/*
          The follow-up appears only on Yes. Rendering it permanently, greyed,
          makes the form look twice as long as it is — and asking "which
          medications" of someone who takes none is how a form gets abandoned.
        */}
        {answer === 'yes' && field.followUp ? (
          <div className="space-y-1.5 rounded-lg border-primary/40 border-l-2 bg-muted/40 p-3">
            <Label htmlFor={`wf-${field.followUp.id}`}>
              {field.followUp.label}
            </Label>
            <Textarea
              id={`wf-${field.followUp.id}`}
              placeholder={field.followUp.placeholder}
              rows={3}
            />
          </div>
        ) : null}
      </fieldset>
    );
  }

  if (field.kind === 'acknowledge') {
    return (
      <div className="space-y-1">
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3">
          <input type="checkbox" className="mt-0.5 size-4 accent-primary" />
          <span className="font-medium text-sm">{field.label}</span>
        </label>
        {field.help ? (
          <p className="pl-3 text-muted-foreground text-xs">{field.help}</p>
        ) : null}
      </div>
    );
  }

  if (field.kind === 'long-text') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`wf-${field.id}`}>{field.label}</Label>
        <Textarea
          id={`wf-${field.id}`}
          placeholder={field.placeholder}
          rows={4}
        />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`wf-${field.id}`}>{field.label}</Label>
      <Input
        id={`wf-${field.id}`}
        type={field.kind === 'date' ? 'date' : 'text'}
        placeholder={field.placeholder}
        defaultValue={prefill}
      />
    </div>
  );
}

/**
 * Scroll-to-accept.
 *
 * The checkbox stays disabled until the box has actually been scrolled to the
 * bottom. It is not a dark pattern in reverse — a consent record is only worth
 * anything if the clinic can say the text was in front of the patient, and a
 * tick placed above three screens of unread text cannot support that.
 */
function LegalScrollToAccept({
  accepted,
  onAccept,
}: {
  accepted: boolean;
  onAccept: (next: boolean) => void;
}) {
  const [reachedEnd, setReachedEnd] = useState(false);

  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="font-semibold text-lg">Consent to treatment</h2>

        <div
          onScroll={(event) => {
            const el = event.currentTarget;
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12) {
              setReachedEnd(true);
            }
          }}
          className="h-48 space-y-3 overflow-y-auto rounded-lg border bg-muted/30 p-4 text-sm leading-relaxed"
        >
          <p>
            I confirm that the nature of dermal filler treatment has been
            explained to me, including the expected results, the number of
            sessions likely to be required, and the fact that results are
            temporary and vary between individuals.
          </p>
          <p>
            I understand the common side effects — swelling, bruising,
            tenderness and redness at the injection site — usually settle within
            seven to ten days, and I have been told which of these warrant
            contacting the clinic.
          </p>
          <p>
            I understand the rare but serious risks, including vascular
            occlusion, infection, nodule formation and, very rarely, damage to
            vision, and that {ORG.name} holds hyaluronidase on site and follows
            a written complications protocol.
          </p>
          <p>
            I confirm the medical history I have given is accurate and complete
            to the best of my knowledge, and I will tell the clinic if anything
            changes before my appointment.
          </p>
          <p>
            I understand I may withdraw my consent at any point before treatment
            begins, and that doing so will not affect my care.
          </p>
        </div>

        {!reachedEnd ? (
          <p className="text-muted-foreground text-xs">
            Scroll to the end of the statement to continue.
          </p>
        ) : null}

        <label
          className={cn(
            'flex items-start gap-3 rounded-lg border p-3',
            reachedEnd ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
          )}
        >
          <input
            type="checkbox"
            disabled={!reachedEnd}
            checked={accepted}
            onChange={(event) => onAccept(event.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span className="font-medium text-sm">
            I have read and agree to the statement above.
          </span>
        </label>
      </CardContent>
    </Card>
  );
}

function SignaturePad({
  signed,
  onSign,
}: {
  signed: boolean;
  onSign: (next: boolean) => void;
}) {
  return (
    <Card>
      <CardContent className="space-y-3 p-5">
        <h2 className="font-semibold text-lg">Sign here</h2>
        {/*
          A drawn signature, not a typed name. It is what the clinic's insurer
          expects on a consent record, and on a phone it is the one thing a
          finger does better than a keyboard.
        */}
        <button
          type="button"
          onClick={() => onSign(true)}
          className={cn(
            'flex h-36 w-full items-center justify-center rounded-xl border-2 border-dashed transition-colors',
            signed
              ? 'border-primary/40 bg-primary/5'
              : 'border-border bg-muted/30 hover:bg-muted/50'
          )}
        >
          {signed ? (
            <span className="font-medium text-primary">
              <CheckIcon className="mr-2 inline size-4" />
              Signed
            </span>
          ) : (
            <span className="flex flex-col items-center gap-1.5 text-muted-foreground text-sm">
              <PenLineIcon className="size-5" />
              Draw your signature with your finger
            </span>
          )}
        </button>
        <div className="flex items-center justify-between">
          <p className="text-muted-foreground text-xs">
            Signed as {CONSENT_FORM.patientFirstName}, today.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onSign(false)}
          >
            Clear
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* --------------------------------------------------------------- states -- */

function StateCard({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: 'neutral' | 'warn' | 'good';
  icon: typeof FileTextIcon;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card
      className={cn(
        tone === 'warn' &&
          'border-amber-500/30 bg-amber-50 dark:bg-amber-950/20',
        tone === 'good' &&
          'border-green-600/30 bg-green-50 dark:bg-green-950/20'
      )}
    >
      <CardContent className="space-y-4 p-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-full bg-background">
          <Icon className="size-5 text-muted-foreground" />
        </span>
        <h1 className="font-bold text-xl">{title}</h1>
        {children}
      </CardContent>
    </Card>
  );
}

function InvalidTokenState() {
  return (
    <StateCard tone="neutral" icon={LinkIcon} title="This link doesn't work">
      {/*
        No detail about WHY. "No such form" and "wrong patient" are both
        information about someone else, handed to whoever holds the URL.
      */}
      <p className="text-muted-foreground text-sm">
        It may have been mistyped, or it may have been replaced by a newer one.
        Check the most recent message from {ORG.name}, or give us a ring and
        we'll send a fresh link.
      </p>
      <Button variant="outline" className="w-full" asChild>
        <a href="tel:01782555240">Call {ORG.name}</a>
      </Button>
    </StateCard>
  );
}

function ExpiredState() {
  return (
    <StateCard tone="warn" icon={ClockIcon} title="This link has expired">
      <p className="text-amber-900/90 text-sm dark:text-amber-200/90">
        {CONSENT_STATES.expiredOnLabel}. We can send you a new one straight
        away.
      </p>
      {/*
        The re-send goes to the number ALREADY on file — displayed masked, never
        as an input. Asking the patient to type a phone number here would turn
        an expired link into a way of testing which numbers this clinic holds,
        which is exactly the disclosure the tokenised route avoids.
      */}
      <div className="rounded-lg border bg-background p-3 text-left">
        <p className="text-muted-foreground text-xs">We'll message</p>
        <p className="font-medium tabular-nums">{CONSENT_STATES.maskedPhone}</p>
      </div>
      <Button className="w-full" size="lg">
        <SendIcon className="size-4" />
        Send me a new link
      </Button>
      <p className="text-muted-foreground text-xs">
        Not your number? Call the clinic — we can't change it from this page.
      </p>
    </StateCard>
  );
}

function SubmittedState() {
  return (
    <StateCard
      tone="good"
      icon={ShieldCheckIcon}
      title="You've already completed this"
    >
      <p className="text-green-800/90 text-sm dark:text-green-300/90">
        {CONSENT_STATES.submittedAtLabel}. There is nothing left to do — we'll
        see you at your appointment.
      </p>
      <div className="space-y-2 rounded-lg border bg-background p-4 text-left">
        <p className="font-medium">{CONSENT_FORM.formName}</p>
        <p className="text-muted-foreground text-sm">
          {CONSENT_FORM.forBookingLabel}
        </p>
        <Separator />
        {/* Read-only: the token was revoked on submit, so nothing here edits. */}
        <dl className="space-y-2 text-sm">
          <ReadOnlyRow label="Regular medication" value="No" />
          <ReadOnlyRow label="Allergies" value="Yes — lidocaine" />
          <ReadOnlyRow label="Pregnant or breastfeeding" value="No" />
          <ReadOnlyRow label="Photos in clinical record" value="Agreed" />
          <ReadOnlyRow label="Photos in marketing" value="Not agreed" />
        </dl>
      </div>
      <Button variant="outline" className="w-full">
        <DownloadIcon className="size-4" />
        Download a copy (PDF)
      </Button>
    </StateCard>
  );
}

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function SavedState() {
  return (
    <StateCard
      tone="neutral"
      icon={FileTextIcon}
      title="Saved — come back any time"
    >
      <p className="text-muted-foreground text-sm">
        {CONSENT_STATES.savedAtLabel}. Your answers are held against this same
        link, so you can pick up where you left off from the message we sent —
        no account, no password.
      </p>
      <div className="text-left">
        <ProgressBar value={2} max={5} label="2 of 5 sections done" />
      </div>
      <Button className="w-full" size="lg">
        <ArrowRightIcon className="size-4" />
        Carry on where I left off
      </Button>
      <p className="flex items-start gap-2 text-left text-muted-foreground text-xs">
        <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
        {CONSENT_FORM.expiresLabel} — after that we'll send a new link rather
        than losing your answers.
      </p>
    </StateCard>
  );
}
