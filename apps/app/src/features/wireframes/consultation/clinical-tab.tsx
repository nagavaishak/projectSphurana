'use client';

/**
 * The Clinical tab — the one genuinely new tab on the client record.
 *
 * Mounted on the REAL record (`features/customers/components/customer-profile
 * .tsx`), which now renders through `components/app/entity-view`. An earlier
 * attempt rebuilt the record's header and tab strip so this could be shown "in
 * place"; that was a duplicate of a shipping page and it rendered wider than
 * the real one.
 *
 * Four sub-sections rather than four more tabs: Photos, Face map, Skin and
 * Treatments share a subject — the patient's body over time — and the strip
 * already holds eleven.
 *
 * WIREFRAME. Static fixtures, no queries, no writes. Delete this file and the
 * `clinical` entry in the record's TABS when the real surface ships.
 */

import { useState } from 'react';

import { cn } from '@/lib/utils';

const SECTIONS = [
  { id: 'photos', label: 'Photos' },
  { id: 'facemap', label: 'Face map' },
  { id: 'skin', label: 'Skin' },
  { id: 'treatments', label: 'Treatments' },
] as const;

const NOT_YET: Record<string, string> = {
  photos:
    'Gallery grouped by visit, upload with stage and area, and the export gate that blocks a photo without marketing consent. Drawn at /dashboard/wireframes/photos.',
  facemap:
    'The annotation canvas — the largest single build in the spec. Drawn full-screen at /wireframe-fullscreen/annotate.',
  skin: 'AI skin analysis report. Drawn at /dashboard/wireframes/skin-analysis.',
  treatments:
    'Treatment history — blocked on the treatment record, which does not exist yet. See docs/handoffs/clinical-record.md §2.5.',
};

export function ClinicalTab() {
  const [section, setSection] = useState<string>('photos');

  return (
    <div className="space-y-6">
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

      <div className="rounded-xl border border-dashed bg-background/60 px-6 py-16 text-center">
        <p className="mx-auto max-w-md text-muted-foreground text-sm">
          {NOT_YET[section]}
        </p>
      </div>
    </div>
  );
}
