import { consentFormSubmissionStatusLabels } from '@borradh-workspace/labels';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

import { useListAppointmentFormSubmissions } from '../api/list-appointment-form-submissions';

function formatSignedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Consent-form submission status list for one appointment (ENG-647 Phase 3).
 * Staff-side: shows each required form with a pending/completed badge and,
 * when signed, who signed and when. Designed for embedding in appointment
 * detail surfaces.
 */
export function AppointmentFormStatus({
  appointmentId,
}: {
  appointmentId: string;
}) {
  const { submissions, isLoading, isError, refetch } =
    useListAppointmentFormSubmissions(appointmentId);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-56" />
        <Skeleton className="h-5 w-44" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-3">
        <p className="text-muted-foreground text-sm">
          Couldn't load consent forms.
        </p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No consent forms for this appointment.
      </p>
    );
  }

  return (
    <ul className="flex flex-col divide-y">
      {submissions.map((submission) => (
        <li
          key={submission.id}
          className="flex items-center justify-between gap-3 py-2"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{submission.title}</p>
            {submission.status === 'completed' && submission.signedByName ? (
              <p className="text-muted-foreground truncate text-xs">
                Signed by {submission.signedByName}
                {submission.signedAt
                  ? ` on ${formatSignedDate(submission.signedAt)}`
                  : ''}
              </p>
            ) : null}
          </div>
          <Badge
            variant={submission.status === 'completed' ? 'default' : 'outline'}
          >
            {consentFormSubmissionStatusLabels[submission.status]}
          </Badge>
        </li>
      ))}
    </ul>
  );
}
