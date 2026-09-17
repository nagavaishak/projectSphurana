import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { cn } from '@/lib/utils';

import { DeleteBlockedTimeScopeDialog } from '../components/delete-blocked-time-scope-dialog';

import {
  BlockedTimeDescriptionField,
  BlockedTimePractitionersField,
  BlockedTimeRecurrenceFields,
  BlockedTimeScopeField,
  BlockedTimeTitleField,
  BlockedTimeTypeField,
  BlockedTimeWhenFields,
} from './blocked-time-fields';
import {
  type BlockedTimeEditTarget,
  type BlockedTimeFormData,
  type BlockedTimeInitial,
  blockedTimeDefaults,
  blockedTimeFormSchema,
} from './blocked-time-form';
import { useBlockedTimeFlow } from './use-blocked-time-flow';

export interface MobileBlockedTimeFormProps {
  formId: string;
  /** Prefill for create mode (from the tapped calendar slot). */
  initial?: BlockedTimeInitial;
  /** When set, the form edits this blocked-time occurrence/series. */
  editing?: BlockedTimeEditTarget | null;
  onSaved: () => void;
  onDeleted?: () => void;
  onPendingChange?: (pending: boolean) => void;
  className?: string;
}

/**
 * Mobile funnel presentation of the SHARED blocked-time core. Composes the same
 * fields the desktop dialog does — type preset (which unlocks `paid`),
 * multi-practitioner selection, and recurrence WITH an end condition — and
 * builds its payload through the same builder. Supports edit + delete.
 */
export function MobileBlockedTimeForm({
  formId,
  initial,
  editing,
  onSaved,
  onDeleted,
  onPendingChange,
  className,
}: MobileBlockedTimeFormProps) {
  const isEditing = !!editing;
  const isRecurringSeries = !!editing?.rrule;
  const [scopeDeleteOpen, setScopeDeleteOpen] = useState(false);

  const { submit, deleteBlockedTime, isSaving, isDeleting, context } =
    useBlockedTimeFlow({
      editing,
      onSaved,
      onDeleted: onDeleted ?? onSaved,
    });

  const defaultValues = useMemo(
    () =>
      blockedTimeDefaults({
        editing,
        initial,
        timeZone: context.timeZone,
      }),
    [editing, initial, context.timeZone]
  );

  const form = useForm<BlockedTimeFormData>({
    resolver: zodResolver(blockedTimeFormSchema),
    defaultValues,
  });

  useEffect(() => {
    onPendingChange?.(isSaving);
  }, [isSaving, onPendingChange]);

  const scope = form.watch('scope');
  // Single-occurrence edits keep the series recurrence untouched.
  const showRecurrence = !(isEditing && isRecurringSeries && scope === 'this');

  const handleDelete = () => {
    if (!editing) return;
    if (isRecurringSeries) {
      setScopeDeleteOpen(true);
      return;
    }
    deleteBlockedTime({ id: editing.id, scope: 'all' });
  };

  return (
    <>
      <form
        id={formId}
        onSubmit={form.handleSubmit(submit)}
        className={cn('flex flex-col gap-6', className)}
      >
        <BlockedTimeTypeField
          form={form}
          types={context.types}
          variant="mobile"
        />
        <BlockedTimeTitleField form={form} variant="mobile" />
        <BlockedTimeWhenFields form={form} variant="mobile" />
        <BlockedTimePractitionersField
          form={form}
          options={context.practitionerOptions}
          variant="mobile"
        />
        {showRecurrence && (
          <section className="flex flex-col gap-3">
            <p className="text-[13px] text-[#8E8E93]">Repeat</p>
            <BlockedTimeRecurrenceFields form={form} variant="mobile" />
          </section>
        )}
        <BlockedTimeDescriptionField form={form} variant="mobile" />
        {isEditing && isRecurringSeries && (
          <BlockedTimeScopeField form={form} />
        )}
      </form>

      {isEditing && (
        <div className="pt-6">
          <ConfirmDeleteDialog
            cancelLabel="Keep"
            description="The blocked time is removed from the calendar and those hours become bookable again. This can’t be undone."
            isPending={isDeleting}
            onConfirm={handleDelete}
            title="Delete this block?"
            trigger={
              <button
                className="flex w-full items-center justify-center gap-2 rounded-full border border-destructive/30 py-3 text-sm font-semibold text-destructive active:bg-destructive/5 disabled:opacity-50"
                disabled={isDeleting}
                type="button"
              >
                {isDeleting ? 'Deleting…' : 'Delete block'}
              </button>
            }
          />
        </div>
      )}

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
