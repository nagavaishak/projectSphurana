'use client';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useDeleteIntakeForm,
  useListIntakeForms,
} from '@/features/intake-forms/api';
import type { IntakeForm } from '@/features/intake-forms/api/types';
import { ClipboardListIcon } from 'lucide-react';
import { useState } from 'react';

interface IntakeFormListProps {
  onEdit: (form: IntakeForm) => void;
}

export function IntakeFormList({ onEdit }: IntakeFormListProps) {
  const { forms, isLoading } = useListIntakeForms();
  const [deleting, setDeleting] = useState<IntakeForm | null>(null);

  const { deleteForm, isDeleting } = useDeleteIntakeForm({
    onSuccess: () => setDeleting(null),
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (forms.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ClipboardListIcon />
          </EmptyMedia>
          <EmptyTitle>No intake forms yet</EmptyTitle>
          <EmptyDescription>
            Create a consultation, consent, or medical-history form — or start
            from a template.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {forms.map((form) => (
          <Card key={form.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-2">
                <span>{form.name}</span>
                {!form.isActive && <Badge variant="secondary">Inactive</Badge>}
              </CardTitle>
              {form.description && (
                <CardDescription>{form.description}</CardDescription>
              )}
            </CardHeader>
            <CardContent className="flex items-center justify-between">
              <span className="text-muted-foreground text-sm">
                {form.fields.length} question
                {form.fields.length === 1 ? '' : 's'}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => onEdit(form)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleting(form)}
                >
                  Delete
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <ConfirmDeleteDialog
        description="The form will stop being sent. Submissions already collected stay on client profiles."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleting) deleteForm(deleting.id);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        open={!!deleting}
        title={<>Delete &ldquo;{deleting?.name}&rdquo;?</>}
      />
    </>
  );
}
