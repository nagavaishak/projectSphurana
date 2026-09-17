import {
  type AppointmentWithRelations,
  listAppointmentsResponseSchema,
} from '@borradh-workspace/contracts';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { APPOINTMENTS_PATH_PATTERNS } from './paths.js';

const APPOINTMENT_STATUSES = [
  'booked',
  'confirmed',
  'arrived',
  'started',
  'completed',
  'cancelled',
  'no_show',
] as const;

interface ListAppointmentsOutput {
  items: AppointmentWithRelations[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * `appointments_listAppointments` — list appointments with filters.
 *
 * Wraps `GET /appointments`. The model uses this for date-range queries
 * (e.g. "show me everything this week"). For a single-day at-a-glance, the
 * model should prefer `summariseUpcomingDay`.
 */
export const listAppointmentsTool = defineTool<
  {
    startDateFrom?: string;
    startDateTo?: string;
    status?: (typeof APPOINTMENT_STATUSES)[number];
    leadId?: string;
    assignedToId?: string;
    limit?: number;
  },
  ListAppointmentsOutput
>({
  feature: 'appointments',
  action: 'listAppointments',
  description:
    'List appointments with optional filters: date range, status, lead, ' +
    'assigned-to. Returns appointment IDs, titles, start/end times, status, ' +
    'and customer info. Default limit 50; cap 500.',
  inputSchema: z.object({
    startDateFrom: z
      .string()
      .optional()
      .describe('Start of date range (ISO datetime or YYYY-MM-DD).'),
    startDateTo: z
      .string()
      .optional()
      .describe('End of date range (ISO datetime or YYYY-MM-DD).'),
    status: z
      .enum(APPOINTMENT_STATUSES)
      .optional()
      .describe('Filter by appointment status.'),
    leadId: z
      .string()
      .optional()
      .describe('Filter to appointments for one lead.'),
    assignedToId: z
      .string()
      .optional()
      .describe('Filter to appointments assigned to a specific staff user.'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Max items to return (default 50, max 500).'),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Listing appointments' },
  additionalAllowedPaths: APPOINTMENTS_PATH_PATTERNS,
  execute: async (input, ctx) => {
    const params = new URLSearchParams();
    if (input.startDateFrom) params.set('startDateFrom', input.startDateFrom);
    if (input.startDateTo) params.set('startDateTo', input.startDateTo);
    if (input.status) params.set('status', input.status);
    if (input.leadId) params.set('leadId', input.leadId);
    if (input.assignedToId) params.set('assignedToId', input.assignedToId);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    const qs = params.toString();
    const data = await ctx.apiFetch(`appointments${qs ? `?${qs}` : ''}`, {
      schema: listAppointmentsResponseSchema,
    });
    return {
      data: {
        items: data.items,
        total: data.total,
        limit: data.limit,
        offset: data.offset,
      },
    };
  },
});
