import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useListLeads } from '@/features/leads/api/list-leads';
import { SearchIcon, UserXIcon } from 'lucide-react';
import { useState } from 'react';

interface ClientPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether the sale already has a client (shows a "remove" option). */
  hasClient?: boolean;
  /** Fires with the chosen lead id, or `null` to clear (walk-in). */
  onSelect: (leadId: string | null) => void;
}

function leadName(lead: {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
}): string {
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim();
  return name || lead.email || lead.phone || 'Unnamed client';
}

/**
 * Searchable client (lead) picker for the POS checkout. Attaching a client is
 * required to sell a membership and useful for any sale that should appear on a
 * client's history.
 */
export function ClientPickerDialog({
  open,
  onOpenChange,
  hasClient,
  onSelect,
}: ClientPickerDialogProps) {
  const [search, setSearch] = useState('');
  const { leads, isLoading } = useListLeads({
    filters: { search: search.trim() || undefined, limit: 20 },
  });

  const pick = (leadId: string | null) => {
    onSelect(leadId);
    onOpenChange(false);
    setSearch('');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add client</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search clients…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {hasClient && (
            <button
              type="button"
              onClick={() => pick(null)}
              className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground hover:bg-accent"
            >
              <UserXIcon className="size-4" /> Remove client (walk-in)
            </button>
          )}
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : leads.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No clients found.
            </p>
          ) : (
            leads.map((lead) => (
              <button
                key={lead.id}
                type="button"
                onClick={() => pick(lead.id)}
                className="flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left hover:bg-accent"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {leadName(lead)}
                  </p>
                  {(lead.email || lead.phone) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {lead.email || lead.phone}
                    </p>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
