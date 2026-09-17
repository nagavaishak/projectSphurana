import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';

import { MobileSearchField } from '@/features/mobile-ui';
import { useListServices } from '@/features/organization-services';
import { useListCategories } from '@/features/service-categories';
import { cn } from '@/lib/utils';

import {
  type AppointmentServicePickerRow,
  groupServicesForAppointmentPicker,
} from './appointment-mobile-service-utils';

interface AppointmentMobileServicePickerProps {
  onSelect: (serviceId: string) => void;
  className?: string;
  /** Drawer flow shows client name under the title. */
  clientName?: string;
}

export function AppointmentMobileServicePicker({
  onSelect,
  className,
  clientName,
}: AppointmentMobileServicePickerProps) {
  const [query, setQuery] = useState('');
  const { services, isLoading } = useListServices({ limit: 100 });
  const { categories } = useListCategories();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((service) => service.name.toLowerCase().includes(q));
  }, [query, services]);

  const grouped = useMemo(
    () => groupServicesForAppointmentPicker(filtered, categories),
    [filtered, categories]
  );

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {clientName ? (
        <p className="pb-3 text-[14px] text-[#8E8E93]">
          For <span className="font-medium text-black">{clientName}</span>
        </p>
      ) : null}

      <div className="pb-3">
        <MobileSearchField
          value={query}
          onChange={setQuery}
          placeholder="Search services..."
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        {isLoading ? (
          <p className="py-6 text-center text-[14px] text-[#8E8E93]">
            Loading services...
          </p>
        ) : grouped.length === 0 ? (
          <p className="py-6 text-center text-[14px] text-[#8E8E93]">
            No services found.
          </p>
        ) : (
          <div className="space-y-4">
            {grouped.map((group) => (
              <section key={group.key}>
                <h3 className="pb-2 text-[13px] font-medium text-[#8E8E93]">
                  {group.label}
                </h3>
                <div className="overflow-hidden rounded-xl border border-[#E8E8E8] bg-white">
                  {group.rows.map((row, index) => (
                    <ServicePickerRow
                      key={row.id}
                      row={row}
                      showDivider={index < group.rows.length - 1}
                      onSelect={() => onSelect(row.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ServicePickerRow({
  row,
  showDivider,
  onSelect,
}: {
  row: AppointmentServicePickerRow;
  showDivider: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-3 px-3 py-3 text-left active:bg-[#F2F2F7]',
        showDivider && 'border-b border-[#F2F2F7]'
      )}
    >
      <span
        className="h-7 w-[5px] shrink-0 rounded-full"
        style={{ backgroundColor: row.accentColor }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 text-[15px] font-medium text-black">
        {row.name}
      </span>
      {row.durationLabel ? (
        <span className="shrink-0 text-[14px] text-[#8E8E93]">
          {row.durationLabel}
        </span>
      ) : null}
      <ChevronRight
        className="size-4 shrink-0 text-[#C7C7CC]"
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );
}
