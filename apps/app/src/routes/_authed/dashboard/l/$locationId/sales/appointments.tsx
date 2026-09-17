import { useResolvedRoutes } from '@/lib/use-routes';
import { Link, createFileRoute } from '@tanstack/react-router';
import { differenceInMinutes, format } from 'date-fns';
import { CalendarCheck } from 'lucide-react';
import { useMemo, useState } from 'react';

import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { useListAppointments } from '@/features/appointments/api';
import { formatMoney, parsePriceTextToCents } from '@/features/sales';
import {
  type DatePreset,
  DatePresetMenu,
  ExportMenu,
  FiltersButton,
  StatusBadge,
  appointmentStatusTone,
  datePresetRange,
  downloadCsv,
  shortRef,
} from '@/features/sales/components/pages/sales-page-ui';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { appointmentStatusLabels } from '@borradh-workspace/api-client/types';
import type { AppointmentWithRelations } from '@borradh-workspace/api-client/types';

export const Route = createFileRoute(
  '/_authed/dashboard/l/$locationId/sales/appointments'
)({
  component: AppointmentSalesPage,
});

/** "1h 30min" / "45min" from a start/end pair. */
function formatDuration(startIso: string, endIso: string): string {
  const mins = Math.max(
    0,
    differenceInMinutes(new Date(endIso), new Date(startIso))
  );
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h && m) return `${h}h ${m}min`;
  if (h) return `${h}h`;
  return `${m}min`;
}

function clientName(appt: AppointmentWithRelations): string {
  if (!appt.lead) return 'Walk-in';
  return `${appt.lead.firstName} ${appt.lead.lastName ?? ''}`.trim();
}

function appointmentPrice(
  appt: AppointmentWithRelations,
  currency: string
): string {
  const priceText = appt.service?.priceText;
  if (!priceText) return '—';
  const cents = parsePriceTextToCents(priceText);
  return cents > 0 ? formatMoney(cents, currency) : priceText;
}

/**
 * Appointment sales, on the shared `ListPage`. One column config renders the
 * desktop table and the phone list, so the ten-column table and the phone row
 * can no longer drift apart.
 */
function AppointmentSalesPage() {
  const routes = useResolvedRoutes();
  const [preset, setPreset] = useState<DatePreset>('month');
  const [search, setSearch] = useState('');
  const range = useMemo(() => datePresetRange(preset), [preset]);
  const { currency } = useOrgCurrency();
  const currencyCode = currency.code;

  const { appointments, isLoading, isError, error } = useListAppointments({
    startDateFrom: range.from,
    startDateTo: range.to,
    limit: 200,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return appointments;
    return appointments.filter(
      (a) =>
        clientName(a).toLowerCase().includes(q) ||
        shortRef(a.id).toLowerCase().includes(q)
    );
  }, [appointments, search]);

  const handleExport = () => {
    downloadCsv(
      'appointments.csv',
      [
        'Ref',
        'Client',
        'Service',
        'Created by',
        'Created date',
        'Scheduled date',
        'Duration',
        'Team member',
        'Price',
        'Status',
      ],
      rows.map((a) => [
        `#${shortRef(a.id)}`,
        clientName(a),
        a.service?.name ?? a.title,
        a.assignedTo?.name ?? '—',
        format(new Date(a.createdAt), 'd MMM yyyy, HH:mm'),
        format(new Date(a.startDate), 'd MMM yyyy, HH:mm'),
        formatDuration(a.startDate, a.endDate),
        a.assignedTo?.name ?? '—',
        appointmentPrice(a, currencyCode),
        appointmentStatusLabels[a.status],
      ])
    );
  };

  const columns: ListColumn<AppointmentWithRelations>[] = [
    {
      id: 'ref',
      header: 'Ref #',
      cell: (a) => (
        <span className="font-medium text-primary">#{shortRef(a.id)}</span>
      ),
    },
    {
      id: 'client',
      header: 'Client',
      mobile: 'primary',
      cell: (a) =>
        a.lead ? (
          <Link
            className="font-medium text-primary hover:underline"
            to={routes.customerDetail(a.lead.id)}
          >
            {clientName(a)}
          </Link>
        ) : (
          <span className="text-muted-foreground">Walk-in</span>
        ),
    },
    {
      id: 'service',
      header: 'Service',
      // Under the client name on a phone: what was booked, and for how long.
      mobile: 'secondary',
      cell: (a) =>
        `${a.service?.name ?? a.title} · ${formatDuration(a.startDate, a.endDate)}`,
    },
    {
      id: 'createdBy',
      header: 'Created by',
      cell: (a) => a.assignedTo?.name ?? '—',
    },
    {
      id: 'createdDate',
      header: 'Created Date',
      cell: (a) => (
        <span className="text-muted-foreground">
          {format(new Date(a.createdAt), 'd MMM yyyy, HH:mm')}
        </span>
      ),
    },
    {
      id: 'scheduledDate',
      header: 'Scheduled Date',
      cell: (a) => format(new Date(a.startDate), 'd MMM yyyy, HH:mm'),
    },
    {
      id: 'duration',
      header: 'Duration',
      cell: (a) => formatDuration(a.startDate, a.endDate),
    },
    {
      id: 'teamMember',
      header: 'Team member',
      cell: (a) => a.assignedTo?.name ?? '—',
    },
    {
      id: 'price',
      header: 'Price',
      align: 'right',
      mobile: 'trailing',
      cell: (a) => (
        <span className="font-medium">{appointmentPrice(a, currencyCode)}</span>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (a) => (
        <StatusBadge tone={appointmentStatusTone[a.status]}>
          {appointmentStatusLabels[a.status]}
        </StatusBadge>
      ),
    },
  ];

  return (
    <>
      <title>Appointments | Borradh</title>

      <ListPage<AppointmentWithRelations>
        config={{
          title: 'Appointments',
          columns,
          rows,
          rowKey: (a) => a.id,
          searchPlaceholder: 'Search by Reference or Client',
          search,
          onSearchChange: setSearch,
          toolbar: (
            <div className="flex flex-wrap items-center gap-2">
              <DatePresetMenu onChange={setPreset} value={preset} />
              <FiltersButton />
              <ExportMenu disabled={!rows.length} onExportCsv={handleExport} />
            </div>
          ),
          isLoading,
          isError,
          errorMessage: error?.message ?? "Couldn't load appointments",
          empty: {
            icon: CalendarCheck,
            title: 'No appointments found',
            description:
              'Appointments booked by your clients will appear here.',
          },
        }}
      />
    </>
  );
}
