import { useCallback } from 'react';

import {
  useCreateBlockedTime,
  useDeleteBlockedTime,
  useUpdateBlockedTime,
} from '../api';

import {
  type BlockedTimeEditTarget,
  type BlockedTimeFormData,
  buildCreateBlockedTimePayload,
  buildUpdateBlockedTimePayload,
} from './blocked-time-form';
import { useBlockedTimeContext } from './use-blocked-time-context';

interface UseBlockedTimeFlowOptions {
  editing?: BlockedTimeEditTarget | null;
  onSaved?: () => void;
  onDeleted?: () => void;
}

/**
 * The single mutation entry point for blocked time. Builds create/update
 * payloads through the shared builders — no surface constructs an API body
 * itself.
 */
export function useBlockedTimeFlow({
  editing,
  onSaved,
  onDeleted,
}: UseBlockedTimeFlowOptions = {}) {
  const context = useBlockedTimeContext();

  const { createBlockedTime, isCreating } = useCreateBlockedTime({
    onSuccess: () => onSaved?.(),
  });
  const { updateBlockedTime, isUpdating } = useUpdateBlockedTime({
    onSuccess: () => onSaved?.(),
  });
  const { deleteBlockedTime, isDeleting } = useDeleteBlockedTime({
    onSuccess: () => onDeleted?.(),
  });

  const submit = useCallback(
    (values: BlockedTimeFormData) => {
      if (editing) {
        updateBlockedTime(
          buildUpdateBlockedTimePayload(values, editing, context)
        );
        return;
      }
      createBlockedTime(buildCreateBlockedTimePayload(values, context));
    },
    [editing, context, createBlockedTime, updateBlockedTime]
  );

  return {
    submit,
    deleteBlockedTime,
    isSaving: isCreating || isUpdating,
    isDeleting,
    context,
  };
}
