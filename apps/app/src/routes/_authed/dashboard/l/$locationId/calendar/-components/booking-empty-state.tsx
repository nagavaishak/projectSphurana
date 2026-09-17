import { CalendarOff, Copy, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

interface BookingEmptyStateProps {
  bookingLink?: string | null;
  providerName?: string;
}

export function BookingEmptyState({
  bookingLink,
  providerName,
}: BookingEmptyStateProps) {
  const handleCopyLink = () => {
    if (bookingLink) {
      navigator.clipboard.writeText(bookingLink);
      toast.success('Booking link copied');
    }
  };

  return (
    <div className="flex h-full items-center justify-center">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarOff />
          </EmptyMedia>
          <EmptyTitle>Your bookings are managed externally</EmptyTitle>
          <EmptyDescription>
            {providerName
              ? `Your appointments are managed through ${providerName}. We send your booking link to leads automatically.`
              : 'We send your booking link to leads automatically. Connect a supported booking system or use Borradh’s built-in booking to see appointments here.'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {bookingLink && (
            <div className="flex items-center gap-2">
              <code className="rounded bg-muted px-3 py-1.5 text-sm">
                {bookingLink}
              </code>
              <Button variant="outline" size="icon" onClick={handleCopyLink}>
                <Copy className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" asChild>
                <a href={bookingLink} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          )}
        </EmptyContent>
      </Empty>
    </div>
  );
}
