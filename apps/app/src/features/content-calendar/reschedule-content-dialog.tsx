import { format, parseISO } from 'date-fns';
import { ArrowRightIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import type { IEvent } from '@/components/calendar/interfaces';

interface RescheduleContentDialogProps {
  open: boolean;
  originalEvent: IEvent;
  updatedEvent: IEvent;
  onCancel: () => void;
  onConfirm: () => void;
}

function formatEventTime(isoString: string) {
  const date = parseISO(isoString);
  return {
    date: format(date, 'EEEE, MMMM d, yyyy'),
    time: format(date, 'h:mm a'),
  };
}

export function RescheduleContentDialog({
  open,
  originalEvent,
  updatedEvent,
  onCancel,
  onConfirm,
}: RescheduleContentDialogProps) {
  const oldTime = formatEventTime(originalEvent.startDate);
  const newTime = formatEventTime(updatedEvent.startDate);

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Content</DialogTitle>
          <DialogDescription>
            Are you sure you want to reschedule this post?
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
          <div className="flex-1 text-sm">
            <p className="text-muted-foreground line-through">{oldTime.date}</p>
            <p className="text-muted-foreground line-through">{oldTime.time}</p>
          </div>
          <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="flex-1 text-sm">
            <p className="font-medium">{newTime.date}</p>
            <p className="font-medium">{newTime.time}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onConfirm}>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
