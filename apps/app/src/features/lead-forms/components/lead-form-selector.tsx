import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, Plus, RefreshCw } from 'lucide-react';
import { useListLeadForms } from '../api';
import type { LeadForm } from '../api/types';

interface LeadFormSelectorProps {
  value?: string;
  onChange: (formId: string | undefined) => void;
  onCreateNew?: () => void;
  placeholder?: string;
  disabled?: boolean;
  /** Only show forms with these statuses */
  statusFilter?: ('draft' | 'synced')[];
}

export function LeadFormSelector({
  value,
  onChange,
  onCreateNew,
  placeholder = 'Select a lead form',
  disabled,
  statusFilter = ['synced'],
}: LeadFormSelectorProps) {
  const { leadForms, isLoading, isError, refetch } = useListLeadForms({
    limit: 100,
  });

  const filteredForms = leadForms.filter((form) =>
    statusFilter.includes(form.status as 'draft' | 'synced')
  );

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />;
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-destructive">Failed to load forms</span>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="size-4 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Select
        value={value || ''}
        onValueChange={(val) => onChange(val || undefined)}
        disabled={disabled}
      >
        <SelectTrigger className="flex-1">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {filteredForms.length === 0 ? (
            <div className="p-2 text-center text-sm text-muted-foreground">
              No lead forms available
            </div>
          ) : (
            filteredForms.map((form) => (
              <SelectItem key={form.id} value={form.id}>
                <div className="flex items-center gap-2">
                  <FileText className="size-4 text-muted-foreground" />
                  <span>{form.name}</span>
                  {form.metaFormId ? (
                    <span className="text-xs text-muted-foreground">
                      (synced)
                    </span>
                  ) : null}
                </div>
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
      {onCreateNew ? (
        <Button variant="outline" onClick={onCreateNew} disabled={disabled}>
          <Plus className="size-4 mr-1" />
          Create
        </Button>
      ) : null}
    </div>
  );
}

export type { LeadForm };
