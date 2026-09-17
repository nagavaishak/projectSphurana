import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import type { OrganizationService } from '@/features/organization-services';
import { cn } from '@/lib/utils';
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  MoreVertical,
  Pencil,
  Settings2,
  Trash2,
} from 'lucide-react';

import type {
  ServiceCategoryGroup,
  ServiceListRow,
} from './services-mobile-utils';

interface ServicesMobileListProps {
  groups: ServiceCategoryGroup[];
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string;
  onEditService: (service: OrganizationService) => void;
  onDeleteService: (serviceId: string) => void;
  onToggleArchive: (service: OrganizationService) => void;
  onAddService: () => void;
}

const serviceRowMenuItemClass =
  'gap-3 rounded-xl px-3 py-2.5 text-[15px] font-normal text-[#0A0A0A] focus:bg-[#F5F5F5]';

function ServicesMobileListSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 py-2">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-20 w-full rounded-xl" />
        </div>
      ))}
    </div>
  );
}

function ServicesMobileListEmpty({
  onAddService,
}: { onAddService: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-12 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-[#F2F2F7]">
        <Settings2 className="size-7 text-[#8E8E93]" strokeWidth={1.75} />
      </div>
      <div className="space-y-1">
        <p className="text-[17px] font-semibold text-[#0A0A0A]">
          No services yet
        </p>
        <p className="text-[15px] leading-snug text-[#737373]">
          Add your first service to get started.
        </p>
      </div>
      <button
        type="button"
        onClick={onAddService}
        className="rounded-full bg-[#0A0A0A] px-5 py-2.5 text-[15px] font-semibold text-white active:scale-[0.98]"
      >
        Add service
      </button>
    </div>
  );
}

function ServiceRowMenu({
  row,
  onEditService,
  onDeleteService,
  onToggleArchive,
}: {
  row: ServiceListRow;
  onEditService: (service: OrganizationService) => void;
  onDeleteService: (serviceId: string) => void;
  onToggleArchive: (service: OrganizationService) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex size-8 shrink-0 items-center justify-center rounded-full text-[#8E8E93] active:bg-[#F2F2F2]"
          aria-label="Service options"
        >
          <MoreVertical className="size-5" strokeWidth={2} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="min-w-[11rem] rounded-2xl border border-[#EBEBEB] bg-white p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
      >
        <DropdownMenuItem
          className={serviceRowMenuItemClass}
          onClick={() => onEditService(row.service)}
        >
          <Pencil className="size-[18px] text-[#525252]" strokeWidth={2} />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          className={serviceRowMenuItemClass}
          onClick={() => onToggleArchive(row.service)}
        >
          {row.service.isActive ? (
            <ArchiveIcon
              className="size-[18px] text-[#525252]"
              strokeWidth={2}
            />
          ) : (
            <ArchiveRestoreIcon
              className="size-[18px] text-[#525252]"
              strokeWidth={2}
            />
          )}
          {row.service.isActive ? 'Archive' : 'Restore'}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          className={cn(
            serviceRowMenuItemClass,
            'text-[#FF3B30] focus:bg-[#FFF1F0] focus:text-[#FF3B30]'
          )}
          onClick={() => onDeleteService(row.service.id)}
        >
          <Trash2 className="size-[18px]" strokeWidth={2} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ServiceListRowItem({
  row,
  onEditService,
  onDeleteService,
  onToggleArchive,
}: {
  row: ServiceListRow;
  onEditService: (service: OrganizationService) => void;
  onDeleteService: (serviceId: string) => void;
  onToggleArchive: (service: OrganizationService) => void;
}) {
  // The list now includes archived services, which are NOT bookable. Two
  // signals rather than one: the badge names the state, and the muted accent
  // and title keep a scanned list honest at a glance.
  const archived = !row.service.isActive;
  return (
    <li className="flex items-center gap-3 px-4 py-4">
      <span
        className={cn(
          'block w-[5px] shrink-0 self-center rounded-full',
          archived && 'opacity-40'
        )}
        style={{
          backgroundColor: row.accentColor,
          minHeight: row.detailLines.length > 1 ? '2.75rem' : '2.25rem',
        }}
        aria-hidden
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p
          className={cn(
            'flex items-center gap-2 text-[15px] font-semibold leading-tight',
            archived ? 'text-[#8E8E93]' : 'text-[#0A0A0A]'
          )}
        >
          <span className="truncate">{row.title}</span>
          {archived && (
            <span className="shrink-0 rounded-full bg-[#F2F2F7] px-2 py-0.5 font-medium text-[#8E8E93] text-[11px] uppercase tracking-wide">
              Archived
            </span>
          )}
        </p>
        {row.detailLines.map((line, index) => (
          <p
            key={`${line}-${index}`}
            className="text-[13px] leading-snug text-[#737373]"
          >
            {line}
          </p>
        ))}
      </div>
      <ServiceRowMenu
        row={row}
        onEditService={onEditService}
        onDeleteService={onDeleteService}
        onToggleArchive={onToggleArchive}
      />
    </li>
  );
}

export function ServicesMobileList({
  groups,
  isLoading,
  isError,
  errorMessage,
  onEditService,
  onDeleteService,
  onToggleArchive,
  onAddService,
}: ServicesMobileListProps) {
  if (isLoading) {
    return <ServicesMobileListSkeleton />;
  }

  if (isError) {
    return (
      <div className="px-4 py-8 text-center text-sm text-destructive">
        {errorMessage ?? 'Failed to load services.'}
      </div>
    );
  }

  if (groups.length === 0) {
    return <ServicesMobileListEmpty onAddService={onAddService} />;
  }

  return (
    <div className="px-4 pb-2">
      <div className="flex flex-col gap-5">
        {groups.map((group) => (
          <section key={group.key}>
            <h2 className="mb-2 px-0.5 text-sm font-medium text-[#8E8E93]">
              {group.label}
            </h2>
            <ul className="divide-y divide-[#F0F0F0] overflow-hidden rounded-xl border border-[#E8E8E8] bg-white">
              {group.rows.map((row) => (
                <ServiceListRowItem
                  key={row.id}
                  row={row}
                  onEditService={onEditService}
                  onDeleteService={onDeleteService}
                  onToggleArchive={onToggleArchive}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
