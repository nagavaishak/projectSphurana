import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MobileSearchField } from '@/features/mobile-ui';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';

import { ServicesMobileChip } from './services-mobile-chip';
import type {
  CategoryFilterValue,
  StaffFilterValue,
} from './services-mobile-utils';

interface ServicesMobileFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: CategoryFilterValue;
  onCategoryFilterChange: (value: CategoryFilterValue) => void;
  staffFilter: StaffFilterValue;
  onStaffFilterChange: (value: StaffFilterValue) => void;
  categoryOptions: { value: CategoryFilterValue; label: string }[];
  staffOptions: { value: StaffFilterValue; label: string }[];
  onAddService: () => void;
  /**
   * Present only where there is another branch to copy from.
   *
   * The phone has no room for a split button, so when EITHER import is
   * available the + opens a menu instead of acting; with neither it keeps
   * acting on the first tap. Spreadsheet import works for every org, so in
   * practice the menu is now always the path — this stays conditional only so
   * the plain + survives if that ever stops being true.
   */
  onImportServices?: () => void;
  /** Upload a .csv/.xlsx price list. Available to every org. */
  onImportServicesCsv?: () => void;
}

export function ServicesMobileFilters({
  search,
  onSearchChange,
  categoryFilter,
  onCategoryFilterChange,
  staffFilter,
  onStaffFilterChange,
  categoryOptions,
  staffOptions,
  onAddService,
  onImportServices,
  onImportServicesCsv,
}: ServicesMobileFiltersProps) {
  const hasImportMenu = Boolean(onImportServices || onImportServicesCsv);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <MobileSearchField
          value={search}
          onChange={onSearchChange}
          placeholder="Search services..."
          className="min-w-0 flex-1"
        />
        {hasImportMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label="Add service"
                className={cn(
                  'flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0A0A0A] text-white',
                  'active:scale-[0.97]'
                )}
                type="button"
              >
                <Plus className="size-5" strokeWidth={2.25} aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem onSelect={onAddService}>
                New service
              </DropdownMenuItem>
              {onImportServicesCsv ? (
                <DropdownMenuItem onSelect={onImportServicesCsv}>
                  Import from a file…
                </DropdownMenuItem>
              ) : null}
              {onImportServices ? (
                <DropdownMenuItem onSelect={onImportServices}>
                  Import from another location…
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button
            aria-label="Add service"
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full bg-[#0A0A0A] text-white',
              'active:scale-[0.97]'
            )}
            onClick={onAddService}
            type="button"
          >
            <Plus className="size-5" strokeWidth={2.25} aria-hidden />
          </button>
        )}
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {categoryOptions.map((option) => (
          <ServicesMobileChip
            key={option.value}
            active={categoryFilter === option.value}
            onClick={() => onCategoryFilterChange(option.value)}
          >
            {option.label}
          </ServicesMobileChip>
        ))}
      </div>

      {staffOptions.length > 1 ? (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {staffOptions.map((option) => (
            <ServicesMobileChip
              key={option.value}
              active={staffFilter === option.value}
              onClick={() => onStaffFilterChange(option.value)}
            >
              {option.label}
            </ServicesMobileChip>
          ))}
        </div>
      ) : null}
    </div>
  );
}
