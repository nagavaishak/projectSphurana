import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { DoubleBookingConflict } from '../api/create-appointment';

interface DoubleBookingConfirmDialogProps {
  /** The server's refusal, or null when there is nothing to confirm. */
  conflict: DoubleBookingConflict | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "This slot is already taken — book it anyway?"
 *
 * Double-booking a practitioner is a real clinic workflow, so this is a
 * confirmation and not a refusal. What it is NOT allowed to be is silent: the
 * calendar used to create the second appointment with no warning at all, so the
 * diary could hold two unfulfillable bookings and nothing on screen said so
 * (ENG-792).
 *
 * The body text is the SERVER's message, which names the conflicting
 * appointment and its time in the organization's timezone. Restating it here
 * would be a second copy to drift — and the client does not know what it
 * collided with, only that it did.
 *
 * Rendered by every create surface (desktop dialog, both mobile funnels) from
 * the one `useCreateAppointmentFlow`, so no surface can quietly go back to
 * booking over people.
 */
export function DoubleBookingConfirmDialog({
  conflict,
  onConfirm,
  onCancel,
}: DoubleBookingConfirmDialogProps) {
  return (
    <AlertDialog
      open={conflict !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>This time is already booked</AlertDialogTitle>
          <AlertDialogDescription>
            {conflict?.message} Booking it anyway will double-book them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>
            Pick another time
          </AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>Book anyway</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
