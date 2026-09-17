/**
 * Factory-shaped appointments tools (W-C07).
 *
 * Tool names produced by the factory: `appointments_<action>` (e.g.
 * `appointments_findOpenSlots`). The `manage-appointments` skill in
 * `packages/features/src/assistant/skills/` references the unprefixed action
 * names; the controller's catalogue aliases them onto the factory-prefixed
 * names so skill `toolNames` resolve cleanly without a rename.
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { bookAppointmentTool } from './book-appointment.tool.js';
import { cancelAppointmentTool } from './cancel-appointment.tool.js';
import { findOpenSlotsTool } from './find-open-slots.tool.js';
import { listAppointmentsTool } from './list-appointments.tool.js';
import { markNoShowTool } from './mark-no-show.tool.js';
import { rescheduleAppointmentTool } from './reschedule-appointment.tool.js';
import { setAppointmentStatusTool } from './set-appointment-status.tool.js';
import { summariseUpcomingDayTool } from './summarise-upcoming-day.tool.js';

export const appointmentsTools: ToolDefinition[] = [
  findOpenSlotsTool,
  listAppointmentsTool,
  summariseUpcomingDayTool,
  bookAppointmentTool,
  rescheduleAppointmentTool,
  cancelAppointmentTool,
  markNoShowTool,
  setAppointmentStatusTool,
];

export {
  bookAppointmentTool,
  cancelAppointmentTool,
  findOpenSlotsTool,
  listAppointmentsTool,
  markNoShowTool,
  rescheduleAppointmentTool,
  setAppointmentStatusTool,
  summariseUpcomingDayTool,
};
