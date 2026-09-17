'use client';

/**
 * Organisation settings › Consent & privacy.
 *
 * Three things that were separate wireframes belong on one page, because they
 * are one subject seen from three angles — the consent record a patient signs:
 *
 *   Renewals   who owes a fresh signature, and by when
 *   Kiosk      the chrome-free screen they sign it on, in the clinic
 *   Data       the export and erasure obligations that ride on that record
 *
 * Splitting them left "consent" meaning three different places depending on
 * whether you were chasing, collecting or deleting.
 *
 * Deliberately NOT merged into `settings/consent-forms`, which already exists
 * and is the TEMPLATE LIBRARY — what the forms say. This page is operational:
 * who has signed what, and what we owe them afterwards.
 */

import { ExternalLinkIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Link } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { WfConsentCompliance } from './wf-consent-compliance';
import { WfDataPrivacy } from './wf-data-privacy';

const SECTIONS = [
  { id: 'renewals', label: 'Renewals' },
  { id: 'kiosk', label: 'In-clinic kiosk' },
  { id: 'data', label: 'Data & privacy' },
];

export function WfConsentPrivacy() {
  const [section, setSection] = useState('renewals');

  return (
    <WfFrame
      name="Consent & privacy"
      location="Organisation settings › Consent & privacy"
      states={SECTIONS}
      activeState={section}
      onState={setSection}
      notes={
        <>
          <WfPoint title="One subject, three angles">
            Chasing a renewal, collecting a signature and honouring an erasure
            request all act on the same consent record. Three separate pages
            made “consent” mean a different place depending on which you were
            doing.
          </WfPoint>
          <WfPoint title="Separate from the template library">
            <code>settings/consent-forms</code> already exists and governs what
            the forms <em>say</em>. This page is about who has signed them.
          </WfPoint>
          <WfPoint title="The kiosk cannot live inside settings">
            A patient holds the iPad, so it renders full-screen with no nav and
            no way out but a staff PIN. It is launched from here and takes over
            the display.
          </WfPoint>
          <WfPoint title="Erasure conflicts with retention">
            §21.2 says deletion removes everything, which collides with
            statutory retention of financial and medical records. The screen
            shows erased and retained side by side rather than implying a clean
            wipe. Legal sign-off needed.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Consent & privacy"
        description="Renewals, in-clinic signing, and what we hold on a patient."
      >
        <div className="flex flex-wrap gap-1 border-b">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSection(s.id)}
              className={cn(
                '-mb-px border-b-2 px-3 py-2 font-medium text-sm transition-colors',
                s.id === section
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              )}
            >
              {s.label}
            </button>
          ))}
        </div>

        {section === 'renewals' ? <WfConsentCompliance embedded /> : null}
        {section === 'kiosk' ? <KioskLaunch /> : null}
        {section === 'data' ? <WfDataPrivacy embedded /> : null}
      </DashboardPage>
    </WfFrame>
  );
}

/**
 * The kiosk is launched, not embedded — it takes the whole display and removes
 * every way out except the staff PIN. Showing it inside a settings page would
 * misrepresent the one property that makes it safe to hand over.
 */
function KioskLaunch() {
  return (
    <div className="max-w-xl space-y-4 py-4">
      <p className="text-muted-foreground">
        Hand the iPad to a patient to complete and sign a form in the clinic.
        The screen takes over the display — no navigation, and the only way back
        is a staff PIN, so nobody can browse another patient’s record.
      </p>
      <Button asChild>
        <Link to="/wireframe-fullscreen/consent-kiosk">
          Start kiosk mode
          <ExternalLinkIcon className="size-4" />
        </Link>
      </Button>
    </div>
  );
}
