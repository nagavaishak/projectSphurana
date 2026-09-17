'use client';

/**
 * §17.4 — the in-clinic kiosk fill. A FULL-SCREEN surface.
 *
 * ## It must not render the dashboard
 *
 * This is an iPad handed across a reception desk to a patient. Every route out
 * of it leads into another patient's records, so it owns the whole viewport and
 * carries no sidebar, no page header, no back link and no breadcrumb. It needs a
 * route beside `/wireframe-fullscreen/*`, not under `/dashboard`.
 *
 * The staff-PIN exit is the requirement, not the polish. A "Done" button that
 * returns to the record hands the next patient's notes to whoever is still
 * holding the device — so leaving takes a PIN, and finishing goes to a neutral
 * thank-you that returns to a welcome screen rather than to anything clinical.
 *
 * ## Everything is sized for a thumb
 *
 * Yes/No are 44px+ targets, one question per block, one section per screen. The
 * patient is standing up, holding a tablet, in a waiting room.
 */

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  DeleteIcon,
  LockIcon,
} from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { SignaturePad } from '@/components/ui/signature-pad';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { KIOSK_SECTIONS } from './mock';

const PATIENT = 'Grace O’Sullivan';

type ViewId = 'form' | 'pin' | 'done';

const VIEWS = [
  { id: 'form', label: 'Filling it in' },
  { id: 'pin', label: 'Staff exit' },
  { id: 'done', label: 'Finished' },
];

export function WfConsentKiosk() {
  const [view, setView] = useState<ViewId>('form');

  return (
    <WfFrame
      name="Consent kiosk"
      location="Full screen · handed to the patient"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="No dashboard chrome, at all">
            A sidebar on this screen is a one-tap route into another patient’s
            record. It belongs beside the consultation wireframes at{' '}
            <code>/wireframe-fullscreen/*</code>, not under{' '}
            <code>/dashboard</code>.
          </WfPoint>
          <WfPoint title="The PIN is a requirement">
            Without it the patient can navigate anywhere. Three wrong attempts
            locks the pad and notifies the owner.
          </WfPoint>
          <WfPoint title="Finishing goes nowhere clinical">
            A thank-you, then a neutral welcome screen after ten seconds. Never
            back to the record — the device is still in the patient’s hands.
          </WfPoint>
          <WfPoint title="Scroll-to-accept is enforced, not decorative">
            Continue stays disabled until the risks text has actually been
            reached, so “she read the risks” is a claim the record can support.
          </WfPoint>
          <WfPoint title="A typed signature is offered">
            Drawing on a canvas is pointer-only. A patient with a tremor still
            has to be able to consent, so the typed path produces the same
            signed artefact.
          </WfPoint>
          <WfPoint title="Offline">
            A treatment room with no signal still takes consent. Answers and the
            signature queue locally and upload when the device reconnects.
          </WfPoint>
        </>
      }
    >
      {view === 'pin' ? <PinPad onCancel={() => setView('form')} /> : null}
      {view === 'done' ? <ThankYou /> : null}
      {view === 'form' ? (
        <Form onExit={() => setView('pin')} onFinish={() => setView('done')} />
      ) : null}
    </WfFrame>
  );
}

/* ------------------------------------------------------------------ form -- */

function Form({
  onExit,
  onFinish,
}: {
  onExit: () => void;
  onFinish: () => void;
}) {
  const [step, setStep] = useState(0);
  const [scrolledToEnd, setScrolledToEnd] = useState(false);

  const section = KIOSK_SECTIONS[step];
  const isLast = step === KIOSK_SECTIONS.length - 1;

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* The only chrome: who this is, how far through, and the lock. */}
      <header className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <p className="font-medium text-sm">{PATIENT} · Injectable consent</p>
          <Button variant="ghost" size="sm" onClick={onExit}>
            <LockIcon className="size-4" />
            Exit
          </Button>
        </div>
        <div className="mx-auto mt-3 max-w-2xl space-y-1.5">
          <Progress value={((step + 1) / KIOSK_SECTIONS.length) * 100} />
          <p className="text-muted-foreground text-xs">
            Section {step + 1} of {KIOSK_SECTIONS.length}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 space-y-6 px-6 py-10">
        <h1 className="font-semibold text-3xl">{section.title}</h1>
        {section.intro ? (
          <p className="text-lg text-muted-foreground leading-relaxed">
            {section.intro}
          </p>
        ) : null}

        {section.questions?.map((question) => (
          <Question
            key={question.id}
            id={question.id}
            label={question.label}
            followUp={question.followUp}
          />
        ))}

        {section.legal ? (
          <div className="space-y-3">
            <div
              className="max-h-72 overflow-y-auto rounded-xl border bg-muted/30 p-5 leading-relaxed"
              onScroll={(event) => {
                const element = event.currentTarget;
                if (
                  element.scrollTop + element.clientHeight >=
                  element.scrollHeight - 8
                ) {
                  setScrolledToEnd(true);
                }
              }}
            >
              <p>{section.legal}</p>
              <p className="mt-4">
                Treatment is not suitable during pregnancy or while
                breastfeeding, nor for anyone with a known allergy to any
                component of the product, an active skin infection at the
                treatment site, or a neuromuscular disorder. You confirm that
                you have had the opportunity to ask questions and that they have
                been answered to your satisfaction.
              </p>
            </div>
            <p
              className={cn(
                'text-sm',
                scrolledToEnd ? 'text-muted-foreground' : 'font-medium'
              )}
            >
              {scrolledToEnd
                ? 'Read in full.'
                : 'Scroll to the end to continue.'}
            </p>
          </div>
        ) : null}

        {section.signature ? (
          <div className="space-y-2">
            <Label htmlFor="kiosk-signature">Signature</Label>
            <SignaturePad
              aria-describedby="kiosk-signature-hint"
              typedValue={PATIENT}
            />
            <p
              id="kiosk-signature-hint"
              className="text-muted-foreground text-sm"
            >
              Signed here, timestamped, and stored against today’s visit.
            </p>
          </div>
        ) : null}
      </main>

      <footer className="border-t px-6 py-5">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <Button
            variant="outline"
            size="lg"
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(0, current - 1))}
          >
            <ArrowLeftIcon className="size-4" />
            Back
          </Button>
          {isLast ? (
            <Button size="lg" onClick={onFinish}>
              <CheckIcon className="size-4" />
              Submit
            </Button>
          ) : (
            <Button
              size="lg"
              disabled={section.legal !== undefined && !scrolledToEnd}
              onClick={() => {
                setScrolledToEnd(false);
                setStep((current) =>
                  Math.min(KIOSK_SECTIONS.length - 1, current + 1)
                );
              }}
            >
              Continue
              <ArrowRightIcon className="size-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Question({
  id,
  label,
  followUp,
}: {
  id: string;
  label: string;
  followUp?: string;
}) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);

  return (
    <div className="space-y-4 rounded-xl border p-5">
      <p className="font-medium text-lg">{label}</p>
      <div className="flex gap-3">
        {(['yes', 'no'] as const).map((option) => (
          <Button
            key={option}
            type="button"
            size="lg"
            variant={answer === option ? 'default' : 'outline'}
            aria-pressed={answer === option}
            className="min-w-32 capitalize"
            onClick={() => setAnswer(option)}
          >
            {option}
          </Button>
        ))}
      </div>
      {/* The follow-up appears under the question that triggered it, so she
          answers while the question is still in front of her. */}
      {answer === 'yes' && followUp ? (
        <div className="space-y-2">
          <Label htmlFor={`${id}-followup`}>{followUp}</Label>
          <Textarea id={`${id}-followup`} rows={3} />
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------- pin -- */

function PinPad({ onCancel }: { onCancel: () => void }) {
  const [pin, setPin] = useState('');

  const press = (digit: string) =>
    setPin((current) => (current.length >= 4 ? current : current + digit));

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-xs space-y-6 text-center">
        <div>
          <LockIcon className="mx-auto size-6 text-muted-foreground" />
          <h1 className="mt-3 font-semibold text-xl">Staff PIN</h1>
          <p className="mt-1 text-muted-foreground text-sm">
            Leaving this form returns to the clinic system. A member of staff
            has to unlock it.
          </p>
        </div>

        <div className="flex justify-center gap-3" aria-hidden="true">
          {[0, 1, 2, 3].map((slot) => (
            <span
              key={slot}
              className={cn(
                'size-3.5 rounded-full border',
                slot < pin.length ? 'bg-foreground' : 'bg-transparent'
              )}
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">
          {pin.length} of 4 digits entered
        </p>

        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
            <Button
              key={digit}
              type="button"
              variant="outline"
              className="h-14 text-lg"
              onClick={() => press(digit)}
            >
              {digit}
            </Button>
          ))}
          <Button
            type="button"
            variant="ghost"
            className="h-14"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-14 text-lg"
            onClick={() => press('0')}
          >
            0
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-14"
            aria-label="Delete last digit"
            onClick={() => setPin((current) => current.slice(0, -1))}
          >
            <DeleteIcon className="size-4" />
          </Button>
        </div>

        <Button className="w-full" disabled={pin.length < 4}>
          Unlock
        </Button>
        <p className="text-muted-foreground text-xs">
          Three wrong attempts locks the pad for two minutes and notifies the
          clinic owner.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- thank you -- */

function ThankYou() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div className="max-w-sm space-y-3">
        <CheckIcon className="mx-auto size-10 text-muted-foreground" />
        <h1 className="font-semibold text-2xl">Thank you</h1>
        <p className="text-muted-foreground">
          Your form is saved. Please hand the iPad back to reception.
        </p>
        {/* Ten seconds, then a neutral welcome screen — never the record. */}
        <p className="text-muted-foreground text-sm">
          Returning to the welcome screen in 10 seconds.
        </p>
      </div>
    </div>
  );
}
