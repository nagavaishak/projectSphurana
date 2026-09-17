import type {
  IntakeAnswer,
  IntakeFormField,
  IntakeSubmission,
} from '@/features/intake-forms/api/types';
import { format } from 'date-fns';
import { FileText } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useListLeadSubmissions } from '@/features/intake-forms/api';

/** Render one answer read-only, by the shape its field type produces. */
function AnswerValue({
  field,
  answer,
}: {
  field: IntakeFormField;
  answer: IntakeAnswer | undefined;
}) {
  if (answer === undefined || answer === null || answer === '') {
    return <span className="text-muted-foreground">—</span>;
  }
  if (field.type === 'signature') {
    return <span className="text-muted-foreground italic">Signed</span>;
  }
  if (typeof answer === 'boolean') {
    return <span>{answer ? 'Yes' : 'No'}</span>;
  }
  if (Array.isArray(answer)) {
    return <span>{answer.join(', ')}</span>;
  }
  if (typeof answer === 'object') {
    // A signature object on a non-signature field — show it was provided.
    return <span className="text-muted-foreground italic">Provided</span>;
  }
  return <span>{String(answer)}</span>;
}

function SubmissionCard({ submission }: { submission: IntakeSubmission }) {
  const completed = submission.status === 'completed';
  // Only real question fields (skip section headings) that were actually asked.
  const questions = submission.fieldsSnapshot.filter(
    (f) => f.type !== 'section'
  );

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileText className="size-4 text-muted-foreground" />
            <span className="font-medium">
              {questions.length} question{questions.length === 1 ? '' : 's'}
            </span>
          </div>
          <Badge variant={completed ? 'default' : 'secondary'}>
            {completed ? 'Completed' : 'Awaiting response'}
          </Badge>
        </div>

        <p className="text-muted-foreground text-xs">
          {completed && submission.completedAt
            ? `Completed ${format(new Date(submission.completedAt), 'd MMM yyyy')}`
            : submission.sentAt
              ? `Sent ${format(new Date(submission.sentAt), 'd MMM yyyy')}`
              : null}
        </p>

        {completed && (
          <dl className="space-y-2 border-t pt-3">
            {questions.map((field) => (
              <div
                key={field.id}
                className="grid grid-cols-[1fr_1fr] gap-2 text-sm"
              >
                <dt className="text-muted-foreground">{field.label}</dt>
                <dd>
                  <AnswerValue
                    field={field}
                    answer={submission.answers[field.id]}
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The client's intake forms — "completed forms saved to client profile". Lists
 * every submission sent to this client, with the answers inline once completed.
 */
export function ClientFormsTab({ leadId }: { leadId: string }) {
  const { submissions, isLoading } = useListLeadSubmissions(leadId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (submissions.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>No forms yet</EmptyTitle>
          <EmptyDescription>
            Intake forms sent to this client will appear here once you attach a
            form to a service they book.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      {submissions.map((submission) => (
        <SubmissionCard key={submission.id} submission={submission} />
      ))}
    </div>
  );
}
