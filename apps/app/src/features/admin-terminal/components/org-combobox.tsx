import { Check, ChevronsUpDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
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
import { cn } from '@/lib/utils';

import { useListAllOrganizations } from '../api';

export interface SelectedOrg {
  id: string;
  name: string;
}

/**
 * Searchable org picker for the admin panel. Search is server-side (debounced)
 * via `useListAllOrganizations`, so it works across all orgs, not just a
 * pre-fetched page. Command's built-in client filtering is disabled.
 */
export function OrgCombobox({
  value,
  onChange,
  className,
}: {
  value: SelectedOrg | null;
  onChange: (org: SelectedOrg) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const { organizations, isLoading } = useListAllOrganizations({
    search: debouncedSearch || undefined,
    limit: 20,
  });

  const handleSelect = (org: SelectedOrg) => {
    setOpen(false);
    onChange(org);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-[320px] justify-between', className)}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>
            {value ? value.name : 'Select an organization…'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search organizations…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {isLoading ? 'Searching…' : 'No organizations found.'}
            </CommandEmpty>
            <CommandGroup>
              {organizations.map((org) => (
                <CommandItem
                  key={org.id}
                  value={org.id}
                  onSelect={() => handleSelect({ id: org.id, name: org.name })}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value?.id === org.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="truncate">{org.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
