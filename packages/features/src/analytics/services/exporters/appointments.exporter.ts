import { appointment } from '@borradh-workspace/database';
import { and, count, lt, sql } from 'drizzle-orm';
import { type DbConnection, notDeleted } from '../../../shared/index.js';
import { type SchemaDefinition, toParquetBuffer } from '../parquet/index.js';
import type { DomainExporter } from './types.js';

const schema: SchemaDefinition = {
  organization_id: { type: 'UTF8' },
  date: { type: 'UTF8' },
  total_appointments: { type: 'INT64' },
  new_appointments: { type: 'INT64' },
  status_scheduled: { type: 'INT64' },
  status_completed: { type: 'INT64' },
  status_no_show: { type: 'INT64' },
  status_cancelled: { type: 'INT64' },
  source_manual: { type: 'INT64' },
  source_booking_form: { type: 'INT64' },
  source_calendar_sync: { type: 'INT64' },
  source_chatbot: { type: 'INT64' },
  no_show_rate: { type: 'DOUBLE', optional: true },
  cancellation_rate: { type: 'DOUBLE', optional: true },
};

export const appointmentsExporter: DomainExporter = {
  domain: 'appointments',

  async export(db: DbConnection, date: Date): Promise<Buffer> {
    const dateStr = date.toISOString().split('T')[0] ?? '';
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(`${dateStr}T23:59:59.999Z`);

    const stats = await db
      .select({
        organizationId: appointment.organizationId,
        total: count(),
        newAppointments: sql<number>`count(*) filter (where ${appointment.createdAt} >= ${dayStart.toISOString()} and ${appointment.createdAt} <= ${dayEnd.toISOString()})`,
        statusScheduled: sql<number>`count(*) filter (where ${appointment.status} in ('booked', 'confirmed', 'arrived', 'started'))`,
        statusCompleted: sql<number>`count(*) filter (where ${appointment.status} = 'completed')`,
        statusNoShow: sql<number>`count(*) filter (where ${appointment.status} = 'no_show')`,
        statusCancelled: sql<number>`count(*) filter (where ${appointment.status} = 'cancelled')`,
        sourceManual: sql<number>`count(*) filter (where ${appointment.source} = 'manual')`,
        sourceBookingForm: sql<number>`count(*) filter (where ${appointment.source} = 'booking_form')`,
        sourceCalendarSync: sql<number>`count(*) filter (where ${appointment.source} = 'calendar_sync')`,
        sourceChatbot: sql<number>`count(*) filter (where ${appointment.source} = 'ai_voice_caller')`,
      })
      .from(appointment)
      .where(and(lt(appointment.createdAt, dayEnd), notDeleted(appointment)))
      .groupBy(appointment.organizationId);

    const rows = stats.map((s) => {
      const total = Number(s.total);
      const noShow = Number(s.statusNoShow);
      const cancelled = Number(s.statusCancelled);
      return {
        organization_id: s.organizationId,
        date: dateStr,
        total_appointments: total,
        new_appointments: Number(s.newAppointments),
        status_scheduled: Number(s.statusScheduled),
        status_completed: Number(s.statusCompleted),
        status_no_show: noShow,
        status_cancelled: cancelled,
        source_manual: Number(s.sourceManual),
        source_booking_form: Number(s.sourceBookingForm),
        source_calendar_sync: Number(s.sourceCalendarSync),
        source_chatbot: Number(s.sourceChatbot),
        no_show_rate: total > 0 ? noShow / total : null,
        cancellation_rate: total > 0 ? cancelled / total : null,
      };
    });

    return toParquetBuffer(schema, rows);
  },
};
