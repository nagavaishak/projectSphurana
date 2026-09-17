import { Button } from '@/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CreateLeadDialog, useListLeads } from '@/features/leads';
import type { Lead } from '@/features/leads';
import { cn } from '@/lib/utils';
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  UserIcon,
} from 'lucide-react';
import * as React from 'react';

interface LeadPickerProps {
  value?: string;
  onValueChange: (leadId: string, lead: Lead | null) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function LeadPicker({
  value,
  onValueChange,
  placeholder = 'Select a client...',
  disabled = false,
  className,
}: LeadPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');

  const { leads, isLoading } = useListLeads({
    filters: {
      search: search || undefined,
      limit: 50,
    },
  });

  const selectedLead = React.useMemo(() => {
    if (!value) return null;
    return leads.find((lead) => lead.id === value) ?? null;
  }, [value, leads]);

  const getLeadDisplayName = (lead: Lead) => {
    const name = lead.lastName
      ? `${lead.firstName} ${lead.lastName}`
      : lead.firstName;
    return lead.email ? `${name} (${lead.email})` : name;
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Select client"
          disabled={disabled}
          className={cn('w-full justify-between', className)}
        >
          <span className="flex items-center gap-2 truncate">
            <UserIcon className="h-4 w-4 shrink-0 opacity-50" />
            {selectedLead ? (
              <span className="truncate">
                {getLeadDisplayName(selectedLead)}
              </span>
            ) : (
              <span className="text-muted-foreground">{placeholder}</span>
            )}
          </span>
          <ChevronsUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search clients..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {isLoading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Loading...
              </div>
            ) : leads.length === 0 ? (
              <div className="flex flex-col items-center gap-3 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No clients found.
                </p>
                <CreateLeadDialog
                  trigger={
                    <Button variant="outline" size="sm">
                      <PlusIcon className="size-4" />
                      Create lead
                    </Button>
                  }
                />
              </div>
            ) : (
              <CommandGroup>
                {leads.map((lead) => (
                  <CommandItem
                    key={lead.id}
                    value={lead.id}
                    onSelect={() => {
                      onValueChange(lead.id, lead);
                      setOpen(false);
                    }}
                  >
                    <div className="flex flex-1 items-center gap-2">
                      <UserIcon className="h-4 w-4 shrink-0 opacity-50" />
                      <div className="flex flex-col">
                        <span className="font-medium">
                          {lead.lastName
                            ? `${lead.firstName} ${lead.lastName}`
                            : lead.firstName}
                        </span>
                        {lead.email ? (
                          <span className="text-xs text-muted-foreground">
                            {lead.email}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <CheckIcon
                      className={cn(
                        'ml-auto h-4 w-4',
                        value === lead.id ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
