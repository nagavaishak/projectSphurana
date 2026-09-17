import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  BlockedTimeDescriptionField,
  type BlockedTimeEditTarget,
  type BlockedTimeFormData,
  type BlockedTimeInitial,
  BlockedTimePractitionersField,
  BlockedTimeRecurrenceFields,
  BlockedTimeScopeField,
  BlockedTimeTitleField,
  BlockedTimeTypeField,
  BlockedTimeWhenFields,
  blockedTimeDefaults,
  blockedTimeFormSchema,
  useBlockedTimeFlow,
} from '../blocked-time';
import { DeleteBlockedTimeScopeDialog } from './delete-blocked-time-scope-dialog';

export type { BlockedTimeEditTarget };

interface BlockedTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefill for create mode (e.g. from a calendar slot). */
  initial?: BlockedTimeInitial;
  /** When set, the dialog edits this blocked time occurrence/series. */
  editing?: BlockedTimeEditTarget | null;
}

/**
 * DESKTOP surface for the SHARED blocked-time core: the same zod schema, the
 * same field components and the same payload builder the mobile funnel uses —
 * only the presentation (a dialog) differs. Instants are resolved in the
 * BUSINESS timezone, matching mobile.
 */
export function BlockedTimeDialog({
  open,
  onOpenChange,
  initial,
  editing,
}: BlockedTimeDialogProps) {
  const isEditing = !!editing;
  const isRecurringSeries = !!editing?.rrule;

  const { submit, deleteBlockedTime, isSaving, isDeleting, context } =
    useBlockedTimeFlow({
      editing,
      onSaved: () => onOpenChange(false),
      onDeleted: () => onOpenChange(false),
    });

  const defaultValues = useMemo(
    () => blockedTimeDefaults({ editing, initial, timeZone: context.timeZone }),
    [editing, initial, context.timeZone]
  );

  const form = useForm<BlockedTimeFormData>({
    resolver: zodResolver(blockedTimeFormSchema),
    defaultValues,
  });

  // Re-seed on the OPEN TRANSITION only.
  //
  // `defaultValues` is a `useMemo` over props, so leaving it to drive this
  // effect meant any parent re-render reset the form WHILE IT WAS OPEN and
  // discarded whatever had been typed. Observed by hand in this dialog: a name
  // entered then lost, and a Location picked then reverted to "All locations".
  // `hasSeeded` makes it fire on false→true only.
  const hasSeeded = useRef(false);
  useEffect(() => {
    if (open && !hasSeeded.current) {
      form.reset(defaultValues);
      hasSeeded.current = true;
    } else if (!open) {
      hasSeeded.current = false;
    }
  }, [open, defaultValues, form]);

  const [scopeDeleteOpen, setScopeDeleteOpen] = useState(false);

  const handleDelete = () => {
    if (!editing) return;
    // Recurring series prompt for this / following / all; one-off deletes now.
    if (isRecurringSeries) {
      setScopeDeleteOpen(true);
      return;
    }
    deleteBlockedTime({ id: editing.id, scope: 'all' });
  };

  const scope = form.watch('scope');
  // Single-occurrence edits keep the series recurrence untouched.
  const showRecurrence = !(isEditing && isRecurringSeries && scope === 'this');

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit blocked time' : 'Add blocked time'}
            </DialogTitle>
            <DialogDescription>
              Block off time so it can&apos;t be booked.
            </DialogDescription>
          </DialogHeader>

          <form
            onSubmit={form.handleSubmit(submit)}
            className="space-y-4"
            id="blocked-time-form"
          >
            <BlockedTimeTypeField form={form} types={context.types} />
            <BlockedTimeTitleField form={form} />
            <BlockedTimeWhenFields form={form} />
            <BlockedTimePractitionersField
              form={form}
              options={context.practitionerOptions}
            />
            {showRecurrence && <BlockedTimeRecurrenceFields form={form} />}
            <BlockedTimeDescriptionField form={form} />
            {isEditing && isRecurringSeries && (
              <BlockedTimeScopeField form={form} />
            )}
          </form>

          <DialogFooter className="gap-2 sm:justify-between">
            {isEditing ? (
              <Button
                type="button"
                variant="destructive"
                disabled={isDeleting}
                onClick={handleDelete}
              >
                {isDeleting ? 'Deleting...' : 'Delete'}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                form="blocked-time-form"
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {editing && (
        <DeleteBlockedTimeScopeDialog
          open={scopeDeleteOpen}
          onOpenChange={setScopeDeleteOpen}
          isDeleting={isDeleting}
          onConfirm={(deleteScope) =>
            deleteBlockedTime({
              id: editing.id,
              scope: deleteScope,
              originalStart: editing.originalStart,
            })
          }
        />
      )}
    </>
  );
}
