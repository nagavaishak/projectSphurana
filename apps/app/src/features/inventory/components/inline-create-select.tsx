/**
 * A searchable single-select combobox with an inline "Create …" affordance.
 * Used for brand / category / supplier pickers on the product form, and the
 * supplier picker on the stock-order form. The `onCreate` callback receives the
 * typed name and must resolve to the created option's id (which is then
 * selected automatically).
 */

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
import { Check, ChevronsUpDown, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

export interface InlineCreateOption {
  id: string;
  name: string;
}

interface InlineCreateSelectProps {
  options: InlineCreateOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  /** Omit to use this as a plain searchable picker with no inline-create row. */
  onCreate?: (name: string) => Promise<string | null>;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** Label shown for the "clear selection" option. Omit to hide. */
  clearLabel?: string;
  id?: string;
  disabled?: boolean;
}

export function InlineCreateSelect({
  options,
  value,
  onChange,
  onCreate,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyLabel = 'Nothing found.',
  clearLabel,
  id,
  disabled,
}: InlineCreateSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

  const selected = options.find((o) => o.id === value) ?? null;
  const trimmed = search.trim();
  const exactMatch = options.some(
    (o) => o.name.toLowerCase() === trimmed.toLowerCase()
  );

  const handleCreate = async () => {
    if (!trimmed || creating || !onCreate) return;
    setCreating(true);
    try {
      const newId = await onCreate(trimmed);
      if (newId) {
        onChange(newId);
        setOpen(false);
        setSearch('');
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {clearLabel && value && (
              <CommandGroup>
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null);
                    setOpen(false);
                  }}
                >
                  <span className="text-muted-foreground">{clearLabel}</span>
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.name}
                  onSelect={() => {
                    onChange(option.id === value ? null : option.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'size-4',
                      option.id === value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {option.name}
                </CommandItem>
              ))}
            </CommandGroup>
            {onCreate && trimmed && !exactMatch && (
              <CommandGroup>
                <CommandItem
                  value={`__create__${trimmed}`}
                  onSelect={handleCreate}
                  disabled={creating}
                >
                  {creating ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Plus className="size-4" />
                  )}
                  Create "{trimmed}"
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
