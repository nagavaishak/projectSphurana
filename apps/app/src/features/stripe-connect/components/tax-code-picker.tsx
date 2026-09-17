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
import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useListStripeTaxCodes } from '../api';

const isCommonClinicChoice = (name: string): boolean => {
  const normalized = name.toLowerCase();
  return (
    normalized.includes('tangible goods') ||
    normalized.includes('cosmetic') ||
    normalized.includes('beauty product')
  );
};

/**
 * Stripe-backed tax-code picker shared by the product and service editors.
 * Suggested choices are filtered from Stripe's fetched catalogue; IDs are
 * never written into Borradh code.
 */
export function TaxCodePicker({
  value,
  onChange,
  disabled = false,
  id,
}: {
  /** Null means let Stripe use the connected account's preset. */
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const { taxCodes, isLoading, isError } = useListStripeTaxCodes();

  const selected = taxCodes.find((code) => code.id === value) ?? null;
  const suggested = useMemo(
    () => taxCodes.filter((code) => isCommonClinicChoice(code.name)),
    [taxCodes]
  );
  const visibleCodes = showAll || suggested.length === 0 ? taxCodes : suggested;

  const select = (next: string | null) => {
    onChange(next);
    setOpen(false);
  };

  const label = isLoading
    ? 'Loading Stripe tax codes…'
    : (selected?.name ?? 'Use clinic default');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading || isError}
          className="w-full justify-between font-normal"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {isError ? 'Could not load tax codes' : label}
          </span>
          <ChevronsUpDown className="size-4 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search Stripe tax codes…" />
          <CommandList>
            <CommandEmpty>No tax code found.</CommandEmpty>
            <CommandGroup heading="Default">
              <CommandItem
                value="use clinic default"
                onSelect={() => select(null)}
              >
                <Check
                  className={cn(
                    'size-4',
                    value === null ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <span>
                  <span className="block">Use clinic default</span>
                  <span className="text-muted-foreground block text-xs">
                    Use the preset configured in Stripe Tax Settings.
                  </span>
                </span>
              </CommandItem>
            </CommandGroup>
            <CommandGroup
              heading={showAll ? 'All Stripe tax codes' : 'Common choices'}
            >
              {visibleCodes.map((code) => (
                <CommandItem
                  key={code.id}
                  value={`${code.name} ${code.description}`}
                  onSelect={() => select(code.id)}
                >
                  <Check
                    className={cn(
                      'size-4',
                      code.id === value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span>
                    <span className="block">{code.name}</span>
                    <span className="text-muted-foreground block text-xs">
                      {code.description}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {!showAll &&
              suggested.length > 0 &&
              suggested.length < taxCodes.length && (
                <CommandGroup>
                  <CommandItem
                    value="show all official stripe tax codes"
                    onSelect={() => setShowAll(true)}
                  >
                    Show all official Stripe tax codes
                  </CommandItem>
                </CommandGroup>
              )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
