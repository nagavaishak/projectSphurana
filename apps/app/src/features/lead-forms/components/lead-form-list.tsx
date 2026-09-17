/**
 * Lead forms list, on the shared `ListPage`.
 *
 * There is no `useIsMobile` branch and no `LeadFormMobileList` any more: the
 * desktop table and the phone list render from the SAME column config, so a
 * column added here cannot silently fail to reach the phone.
 */

import {
  AlertCircle,
  CheckCircle2,
  ClipboardList,
  Cloud,
  FileText,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { useDeleteLeadForm, useListLeadForms, useSyncLeadForm } from '../api';
import type { LeadForm, LeadFormStatus } from '../api/types';
import { leadFormStatusLabels } from '../api/types';

interface LeadFormListProps {
  onEdit?: (form: LeadForm) => void;
  onCreateNew?: () => void;
}

const statusVariants: Record<
  LeadFormStatus,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  draft: 'secondary',
  synced: 'default',
  error: 'destructive',
  archived: 'outline',
};

const statusIcons: Record<LeadFormStatus, ReactNode> = {
  draft: <FileText className="size-3" />,
  synced: <CheckCircle2 className="size-3" />,
  error: <AlertCircle className="size-3" />,
  archived: <FileText className="size-3" />,
};

function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function LeadFormList({ onEdit, onCreateNew }: LeadFormListProps) {
  const { leadForms, isLoading, isError, error } = useListLeadForms({
    limit: 50,
  });

  const { deleteLeadForm } = useDeleteLeadForm();
  const { syncLeadForm, isSyncing } = useSyncLeadForm();

  const columns: ListColumn<LeadForm>[] = [
    {
      id: 'name',
      header: 'Name',
      mobile: 'primary',
      cell: (form) => (
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
            <FileText className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="font-medium">{form.name}</div>
            {form.syncError ? (
              <div className="text-destructive text-xs">
                Sync error: {form.syncError}
              </div>
            ) : null}
          </div>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      mobile: 'trailing',
      cell: (form) => (
        <div className="flex items-center gap-2">
          <Badge className="gap-1" variant={statusVariants[form.status]}>
            {statusIcons[form.status]}
            {leadFormStatusLabels[form.status]}
          </Badge>
          {form.metaFormId && (
            <Badge className="gap-1" variant="outline">
              <Cloud className="size-3" />
              Meta
            </Badge>
          )}
        </div>
      ),
    },
    {
      id: 'questions',
      header: 'Questions',
      mobile: 'secondary',
      cell: (form) => {
        const count = form.questions?.length ?? 0;
        return (
          <span>
            {count}
            {/*
              The phone row has no column header to explain a bare number, so
              the unit rides along there and is hidden on the desktop table.
            */}
            <span className="md:hidden">
              {count === 1 ? ' question' : ' questions'}
            </span>
          </span>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Created',
      cell: (form) => (
        <span className="whitespace-nowrap text-muted-foreground text-sm">
          {formatDate(form.createdAt)}
        </span>
      ),
    },
    {
      id: 'lastSyncAt',
      header: 'Last synced',
      cell: (form) => (
        <span className="whitespace-nowrap text-muted-foreground text-sm">
          {formatDate(form.lastSyncAt)}
        </span>
      ),
    },
  ];

  return (
    <ListPage<LeadForm>
      config={{
        title: 'Lead forms',
        columns,
        rows: leadForms,
        rowKey: (form) => form.id,
        onRowClick: onEdit,
        rowActions: (form) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="Row actions"
                className="size-8"
                size="icon"
                variant="ghost"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onEdit ? (
                <DropdownMenuItem onClick={() => onEdit(form)}>
                  <Pencil className="size-4" />
                  Edit
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                disabled={isSyncing}
                onClick={() => syncLeadForm({ id: form.id })}
              >
                <RefreshCw
                  className={`size-4 ${isSyncing ? 'animate-spin' : ''}`}
                />
                {isSyncing ? 'Syncing...' : 'Sync to Meta'}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => deleteLeadForm(form.id)}
              >
                <Trash2 className="size-4" />
                Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
        primaryAction: onCreateNew
          ? {
              label: 'Create Lead Form',
              mobileLabel: 'Create',
              onClick: onCreateNew,
            }
          : undefined,
        isLoading,
        isError,
        errorMessage: error?.message ?? 'Failed to load lead forms.',
        empty: {
          icon: ClipboardList,
          title: 'No lead forms yet',
          description:
            'Create a lead form to collect leads from your Meta ad campaigns.',
        },
      }}
    />
  );
}
