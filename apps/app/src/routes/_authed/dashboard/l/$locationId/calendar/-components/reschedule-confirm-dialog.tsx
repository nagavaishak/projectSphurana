import { format } from 'date-fns';
import { ArrowRightIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';

import { useCalendar } from '@/components/calendar';
import { zonedEvent } from '@/lib/timezone';

import type { IEvent } from '@/components/calendar/interfaces';

interface RescheduleConfirmDialogProps {
  open: boolean;
  originalEvent: IEvent;
  updatedEvent: IEvent;
  onCancel: () => void;
  onConfirmWithoutEmail: () => void;
  onConfirmWithEmail: (message?: string) => void;
}

function formatEventTime(isoString: string, timeZone: string) {
  const date = zonedEvent(isoString, timeZone);
  return {
    date: format(date, 'EEEE, MMMM d, yyyy'),
    time: format(date, 'h:mm a'),
  };
}

export function RescheduleConfirmDialog({
  open,
  originalEvent,
  updatedEvent,
  onCancel,
  onConfirmWithoutEmail,
  onConfirmWithEmail,
}: RescheduleConfirmDialogProps) {
  const { timeZone } = useCalendar();
  const [message, setMessage] = useState('');

  const oldTime = formatEventTime(originalEvent.startDate, timeZone);
  const newTime = formatEventTime(updatedEvent.startDate, timeZone);

  const handleConfirmWithEmail = () => {
    onConfirmWithEmail(message.trim() || undefined);
    setMessage('');
  };

  const handleCancel = () => {
    setMessage('');
    onCancel();
  };

  const handleConfirmWithoutEmail = () => {
    setMessage('');
    onConfirmWithoutEmail();
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && handleCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reschedule Appointment</DialogTitle>
          <DialogDescription>
            Would you like to send an update email to the client?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-muted p-3">
            <div className="flex-1 text-sm">
              <p className="text-muted-foreground line-through">
                {oldTime.date}
              </p>
              <p className="text-muted-foreground line-through">
                {oldTime.time}
              </p>
            </div>
            <ArrowRightIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 text-sm">
              <p className="font-medium">{newTime.date}</p>
              <p className="font-medium">{newTime.time}</p>
            </div>
          </div>

          <Textarea
            placeholder="Add an optional message for the client"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
          />
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleConfirmWithoutEmail}>
            Do not send
          </Button>
          <Button onClick={handleConfirmWithEmail}>Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
