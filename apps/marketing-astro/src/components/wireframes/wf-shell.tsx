'use client';

/**
 * Chrome shared by the wireframe pages.
 *
 * Both shells are lifted from the surfaces they sit beside so a new page reads
 * as part of the same product: `WfPortalShell` matches the portal header
 * (`components/portal/portal-shell.tsx`), and `WfWizardShell` matches the
 * booking wizard's sticky breadcrumb header (`booking-wizard-content.tsx`).
 */

import { ArrowLeftIcon, ChevronRightIcon, XIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ORG } from './mock';

function OrgMark() {
  return (
    <span className="flex size-7 items-center justify-center rounded-md bg-primary font-semibold text-[11px] text-primary-foreground">
      {ORG.logoInitials}
    </span>
  );
}

interface WfPortalShellProps {
  /** Shown left of the org name when the page is a sub-page. */
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Header + page frame for the account-side pages. */
export function WfPortalShell({
  backLabel,
  actions,
  children,
}: WfPortalShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 border-b bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            {backLabel ? (
              <Button
                variant="outline"
                size="icon"
                className="size-8 shrink-0 rounded-full"
                aria-label={backLabel}
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
            ) : (
              <OrgMark />
            )}
            <span className="truncate font-semibold">
              {backLabel ?? ORG.name}
            </span>
          </div>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      </header>
      {children}
    </div>
  );
}

const WIZARD_STEPS = ['Services', 'Time', 'Confirm'] as const;

interface WfWizardShellProps {
  /**
   * Which breadcrumb reads as current. A plain string rather than the default
   * step union, because `steps` replaces that union wholesale — typing it
   * against `WIZARD_STEPS` made every caller that passes its own steps a type
   * error while still compiling to correct markup.
   */
  activeStep?: string;
  /** Replaces the default three-step breadcrumb entirely. */
  steps?: readonly string[];
  children: ReactNode;
}

/** Header + page frame matching the booking wizard. */
export function WfWizardShell({
  activeStep = 'Services',
  steps = WIZARD_STEPS,
  children,
}: WfWizardShellProps) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b bg-background px-4 py-4 md:px-6">
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            size="icon"
            className="rounded-full"
            aria-label="Go back"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <nav className="hidden items-center gap-2 sm:flex">
            {steps.map((step, i) => (
              <div key={step} className="flex items-center gap-2">
                {i > 0 && (
                  <ChevronRightIcon className="size-4 text-muted-foreground" />
                )}
                <span
                  className={cn(
                    'text-sm',
                    step === activeStep
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {step}
                </span>
              </div>
            ))}
          </nav>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="rounded-full"
          aria-label="Close"
        >
          <XIcon className="size-4" />
        </Button>
      </header>
      {children}
    </div>
  );
}

/**
 * The wizard's two-column body: content left, sticky summary right.
 * Same grid as `booking-wizard-content.tsx` so the columns line up if a
 * wireframe page is opened next to the live wizard.
 */
export function WfWizardBody({
  children,
  aside,
}: {
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <main className="mx-auto grid max-w-5xl gap-8 px-4 py-8 md:grid-cols-[1fr_360px] md:px-6">
      <div className="min-w-0">{children}</div>
      {aside ? <aside>{aside}</aside> : null}
    </main>
  );
}

/** The sticky right-hand card used by the wizard's cart panel. */
export function WfSummaryCard({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full flex-col rounded-2xl border bg-card p-6 shadow-sm md:sticky md:top-[6.25rem] md:max-w-sm">
      {children}
    </div>
  );
}

/**
 * A banner naming what is not real on the page. Every wireframe carries one —
 * these pages get shown to people who have not read the brief, and an
 * unmarked static page invites feedback on data instead of on design.
 */
export function WfNote({ children }: { children: ReactNode }) {
  return (
    <div className="border-amber-500/30 border-b bg-amber-50 dark:bg-amber-950/30">
      <p className="mx-auto max-w-5xl px-4 py-2.5 text-amber-900 text-xs sm:px-6 dark:text-amber-200">
        <span className="font-semibold">Wireframe.</span> {children}
      </p>
    </div>
  );
}
