import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateLead } from '@/features/leads';
import type { LeadProfileLead } from '../api';

/**
 * Notes tab — the one editable piece of the profile. Saves through the
 * existing update-lead endpoint/hook (`PUT /leads/:id`), which also
 * invalidates the profile query so the header stays in sync.
 *
 * ── Why each section is its own independent save (ENG-791) ──────────────────
 *
 * The two notes on this tab are different in kind: `notes` is staff-internal
 * and `portalNote` is PUBLISHED to the customer's portal. They were saved by
 * rebuilding the WHOLE lead record from the `lead` prop with one field
 * swapped, which broke both ways:
 *
 *  - Saving internal notes sent `portalNote: lead.portalNote ?? ''`, and `''`
 *    is the wire encoding for "clear this note" — so it actively erased the
 *    customer-facing note rather than leaving it alone.
 *  - Two saves in succession each built their body from the last snapshot the
 *    query had, so whichever landed second re-published the other field at its
 *    pre-save value. Last write wins, both toasts say "updated", and the loss
 *    is only visible after a reload.
 *
 * Now each button sends only its own key. `PUT /leads/:id` is PATCH-shaped, so
 * an absent key is genuinely untouched server-side and neither save can reach
 * the other's field — no ordering, no snapshot, nothing to race.
 */
export function PatientNotesTab({ lead }: { lead: LeadProfileLead }) {
  return (
    <div className="space-y-8">
      <NoteSection
        leadId={lead.id}
        field="notes"
        saved={lead.notes}
        title="Internal notes"
        description="Only your team can see this. The customer never sees it."
        placeholder="Notes about this patient — preferences, history, anything the team should know."
        rows={8}
        saveLabel="Save internal notes"
      />

      <div className="border-t pt-6">
        <NoteSection
          leadId={lead.id}
          field="portalNote"
          saved={lead.portalNote}
          title="Note for the customer"
          description="Shown to this customer on their portal home page. Kept separate from internal notes so nothing private is ever published by accident."
          placeholder="Aftercare instructions, what to bring, anything you want this customer to read."
          rows={6}
          saveLabel="Save customer note"
        />
      </div>
    </div>
  );
}

interface NoteSectionProps {
  leadId: string;
  /** Which lead key this section owns — and the ONLY key it ever sends. */
  field: 'notes' | 'portalNote';
  /** The value currently stored on the server. */
  saved: string | null;
  title: string;
  description: string;
  placeholder: string;
  rows: number;
  saveLabel: string;
}

/**
 * One note, one textarea, one save button, one mutation.
 *
 * Each section calls `useUpdateLead()` for itself, so the two sections have
 * independent pending state: saving the internal note no longer disables (or
 * puts a spinner on) the customer-note button, which is what made the two
 * saves feel like they had to be fired back-to-back in the first place.
 */
function NoteSection({
  leadId,
  field,
  saved,
  title,
  description,
  placeholder,
  rows,
  saveLabel,
}: NoteSectionProps) {
  const savedValue = saved ?? '';
  const [value, setValue] = useState(savedValue);
  const { updateLead, isUpdating } = useUpdateLead();

  // Adopt a new SERVER value without discarding an unsaved LOCAL edit.
  //
  // The profile query refetches whenever any lead mutation settles — including
  // the sibling section's. Blindly assigning `saved` into state on every change
  // meant a refetch triggered by saving the internal note would wipe whatever
  // the user had typed into the customer note but not yet saved. So the reset
  // only happens when the user has no pending edit of their own (local value
  // still equals the server value we last saw).
  const lastSaved = useRef(savedValue);
  useEffect(() => {
    if (lastSaved.current === savedValue) return;
    setValue((current) =>
      current === lastSaved.current ? savedValue : current
    );
    lastSaved.current = savedValue;
  }, [savedValue]);

  const isDirty = value !== savedValue;

  return (
    <section className="space-y-3">
      <div>
        <h3 className="font-medium text-sm">{title}</h3>
        <p className="text-muted-foreground text-sm">{description}</p>
      </div>
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        aria-label={title}
      />
      <div className="flex justify-end">
        <Button
          onClick={() =>
            // ONE key. Everything else on the lead is left untouched by the
            // server because the wire body simply does not mention it.
            updateLead({ leadId, input: { [field]: value } })
          }
          disabled={!isDirty || isUpdating}
        >
          {isUpdating && <Loader2 className="size-4 animate-spin" />}
          {isUpdating ? 'Saving…' : saveLabel}
        </Button>
      </div>
    </section>
  );
}
