import { format } from 'date-fns';
import { ClipboardList, DownloadIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useGetSubmissionPdf } from '@/features/consent-forms/api/get-submission-pdf';
import { useOpenStaffPatientDocument } from '@/features/patient-documents/api/use-open-document';
import { cn } from '@/lib/utils';
import type {
  ConsentFormSubmissionStatus,
  LeadProfileConsentFormSubmission,
  LeadProfileUploadedConsentForm,
} from '../api';

const statusBadgeClass: Record<ConsentFormSubmissionStatus, string> = {
  pending:
    'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  completed:
    'border-transparent bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300',
};

const statusLabel: Record<ConsentFormSubmissionStatus, string> = {
  pending: 'Pending',
  completed: 'Completed',
};

/**
 * Forms tab — every consent form this patient has, whichever way it arrived.
 *
 * Two sources, deliberately one table. The digital ones are
 * `consent_form_submission` rows, sent at booking and signed in the portal.
 * The paper ones came in through the bulk importer, which read them, saw a
 * consent form, and filed them against this client — they have no submission
 * row and cannot have one, since that table requires an appointment and a
 * template. Splitting them across two places would mean "has this client
 * consented?" needs asking twice, which is how a clinic ends up treating
 * someone on the strength of a form nobody could find.
 */
export function PatientFormsTab({
  leadId,
  submissions,
  uploaded = [],
}: {
  leadId: string;
  submissions: LeadProfileConsentFormSubmission[];
  uploaded?: LeadProfileUploadedConsentForm[];
}) {
  const {
    downloadSubmissionPdf,
    isDownloadingSubmissionPdf,
    downloadingSubmissionId,
  } = useGetSubmissionPdf();
  const { openDocument, openingId } = useOpenStaffPatientDocument(leadId);

  if (submissions.length === 0 && uploaded.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardList />
          </EmptyMedia>
          <EmptyTitle>No consent forms yet</EmptyTitle>
          <EmptyDescription>
            Consent forms are sent automatically when this patient books a
            service that requires them.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Form</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Signed</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {submissions.map((submission) => (
            <TableRow key={submission.id}>
              <TableCell>
                <p className="font-medium">{submission.title}</p>
                {submission.sentAt && (
                  <p className="text-muted-foreground text-sm">
                    Sent {format(new Date(submission.sentAt), 'd MMM yyyy')}
                  </p>
                )}
              </TableCell>
              <TableCell>
                <Badge
                  className={cn('text-xs', statusBadgeClass[submission.status])}
                >
                  {statusLabel[submission.status]}
                </Badge>
              </TableCell>
              <TableCell>
                {submission.status === 'completed' && submission.signedAt ? (
                  <>
                    <p className="text-sm">{submission.signedByName ?? '—'}</p>
                    <p className="text-muted-foreground text-sm">
                      {format(new Date(submission.signedAt), 'd MMM yyyy')}
                    </p>
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell>
                {submission.status === 'completed' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Download signed PDF: ${submission.title}`}
                    disabled={
                      isDownloadingSubmissionPdf &&
                      downloadingSubmissionId === submission.id
                    }
                    onClick={() => downloadSubmissionPdf(submission.id)}
                  >
                    <DownloadIcon aria-hidden />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}

          {uploaded.map((form) => (
            <TableRow key={form.id}>
              <TableCell>
                <p className="font-medium">{form.fileName}</p>
                <p className="text-muted-foreground text-sm">
                  Uploaded {format(new Date(form.filedAt), 'd MMM yyyy')}
                </p>
              </TableCell>
              <TableCell>
                <Badge className={cn('text-xs', statusBadgeClass.completed)}>
                  On file
                </Badge>
              </TableCell>
              {/*
                A scan carries no signed-by name or timestamp we can stand
                over — whatever is written on the page was not captured by us.
                Saying "—" is the honest answer; inventing a signatory from the
                filename would not be.
              */}
              <TableCell>
                <span className="text-muted-foreground">—</span>
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Open consent form: ${form.fileName}`}
                  disabled={openingId === form.documentId}
                  onClick={() => openDocument(form.documentId)}
                >
                  <DownloadIcon aria-hidden />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
