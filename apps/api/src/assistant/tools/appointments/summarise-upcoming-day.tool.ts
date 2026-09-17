import { listAppointmentsResponseSchema } from '@borradh-workspace/contracts';
import type { AppointmentStatus } from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

/**
 * The subset of an appointment this summary reports.
 *
 * `assignedToId` is NULLABLE — the `appointment` table declares it so, and an
 * earlier hand-written version of this interface claimed `string`. That lie
 * fed the grouping key below: an appointment with neither a practitioner nor
 * an assignee produced the literal bucket `"staff:null"` rather than being
 * recognised as unassigned. Deriving the response from
 * `listAppointmentsResponseSchema` is what surfaced it — `tsc` rejected the
 * narrowing outright.
 */
interface AppointmentRow {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  status: AppointmentStatus;
  practitionerId: string | null;
  assignedToId: string | null;
  lead?: { firstName: string; lastName: string | null } | null;
  assignedTo?: { id: string; name: string } | null;
}

interface DaySummaryEntry {
  practitionerLabel: string;
  appointmentCount: number;
  earliest: string | null;
  latest: string | null;
}

interface SummariseUpcomingDayOutput {
  date: string;
  totalScheduled: number;
  totalCancelled: number;
  totalCompleted: number;
  totalNoShow: number;
  byPractitioner: DaySummaryEntry[];
  upcoming: AppointmentRow[];
}

/**
 * `appointments_summariseUpcomingDay` — produce an at-a-glance summary of a
 * single day: counts by status, breakdown by practitioner/assignee, and the
 * raw upcoming list.
 *
 * Wraps `GET /appointments` and aggregates in-memory. The model uses this
 * for "what's tomorrow look like?" queries; for raw range queries it should
 * prefer `listAppointments`.
 */
export const summariseUpcomingDayTool = defineTool<
  { date: string },
  SummariseUpcomingDayOutput
>({
  feature: 'appointments',
  action: 'summariseUpcomingDay',
  description:
    'Summarise a single day in the appointment book: counts per status, ' +
    'per-practitioner breakdown, and the upcoming list. Pass a date in ' +
    'YYYY-MM-DD; the tool covers 00:00–23:59 of that day in the org timezone.',
  inputSchema: z.object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.')
      .describe('Date in YYYY-MM-DD format.'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Summarising the day' },
  additionalAllowedPaths: APPOINTMENTS_PATH_PATTERNS,
  execute: async ({ date }, ctx) => {
    const start = `${date}T00:00:00.000Z`;
    const end = `${date}T23:59:59.999Z`;
    const params = new URLSearchParams();
    params.set('startDateFrom', start);
    params.set('startDateTo', end);
    params.set('limit', '500');
    const data = await ctx.apiFetch(`appointments?${params.toString()}`, {
      schema: listAppointmentsResponseSchema,
    });

    const counts = {
      booked: 0,
      confirmed: 0,
      arrived: 0,
      started: 0,
      cancelled: 0,
      completed: 0,
      no_show: 0,
      // Reserved but unpaid — will release itself if never confirmed, so it is
      // worth the assistant distinguishing from a real booking.
      held: 0,
    };
    const byPractitionerMap = new Map<
      string,
      { label: string; rows: AppointmentRow[] }
    >();

    for (const row of data.items) {
      counts[row.status] += 1;
      // Neither a practitioner nor an assignee is a real state (both columns
      // are nullable), and it must not become the string "staff:null".
      const key = row.practitionerId
        ? `practitioner:${row.practitionerId}`
        : row.assignedToId
          ? `staff:${row.assignedToId}`
          : 'unassigned';
      const label =
        row.assignedTo?.name ??
        (row.practitionerId
          ? `Practitioner ${row.practitionerId}`
          : 'Unassigned');
      const bucket = byPractitionerMap.get(key) ?? { label, rows: [] };
      bucket.rows.push(row);
      byPractitionerMap.set(key, bucket);
    }

    const byPractitioner: DaySummaryEntry[] = [...byPractitionerMap.values()]
      .map(({ label, rows }) => {
        const sorted = [...rows].sort((a, b) =>
          a.startDate.localeCompare(b.startDate)
        );
        return {
          practitionerLabel: label,
          appointmentCount: rows.length,
          earliest: sorted[0]?.startDate ?? null,
          latest: sorted[sorted.length - 1]?.endDate ?? null,
        };
      })
      .sort((a, b) => b.appointmentCount - a.appointmentCount);

    const upcoming = [...data.items].sort((a, b) =>
      a.startDate.localeCompare(b.startDate)
    );

    return {
      data: {
        date,
        totalScheduled:
          counts.booked + counts.confirmed + counts.arrived + counts.started,
        totalCancelled: counts.cancelled,
        totalCompleted: counts.completed,
        totalNoShow: counts.no_show,
        byPractitioner,
        upcoming,
      },
    };
  },
});
