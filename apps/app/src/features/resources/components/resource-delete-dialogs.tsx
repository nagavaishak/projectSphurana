import { PowerOffIcon } from 'lucide-react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';

interface ResourceDeleteConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  isDeleting: boolean;
  onConfirm: () => void;
}

/** Plain "are you sure" for a delete that has nothing blocking it. */
export function ResourceDeleteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  isDeleting,
  onConfirm,
}: ResourceDeleteConfirmDialogProps) {
  return (
    <ConfirmDeleteDialog
      description={description}
      isPending={isDeleting}
      onConfirm={onConfirm}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    />
  );
}

interface ResourceDeleteGuardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /**
   * The API's OWN 409 copy, rendered verbatim — e.g. "Room 2 has 4 upcoming
   * bookings. Deactivate it instead, or move those bookings first." Rewording
   * it here would let the frontend's version drift from the backend's.
   */
  message: string;
  isDeactivating: boolean;
  onDeactivate: () => void;
}

/**
 * The 409 guard.
 *
 * A delete the API refused is NOT a failure — the response carries the user's
 * other move. Letting it land as the generic red error toast strands them with
 * "Failed to delete" and no way forward, so the conflict gets its own prompt
 * with **Deactivate instead** as the primary action. A deactivated resource
 * keeps its history and stops being assignable, which is what "delete" meant
 * to the user in the first place.
 *
 * Renders through `ConfirmDeleteDialog` like every other confirmation, with the
 * labels and icon carrying the difference: deactivating is not a delete, so the
 * button says so and the medallion is a power icon rather than a bin. The
 * destructive styling stays — this is still the end of the road for a resource
 * the operator meant to remove.
 */
export function ResourceDeleteGuardDialog({
  open,
  onOpenChange,
  title,
  message,
  isDeactivating,
  onDeactivate,
}: ResourceDeleteGuardDialogProps) {
  return (
    <ConfirmDeleteDialog
      confirmLabel={isDeactivating ? 'Deactivating...' : 'Deactivate instead'}
      description={message}
      icon={PowerOffIcon}
      isPending={isDeactivating}
      onConfirm={onDeactivate}
      onOpenChange={onOpenChange}
      open={open}
      title={title}
    />
  );
}
