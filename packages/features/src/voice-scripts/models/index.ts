// Voice Script Types
export type { VoiceScript, NewVoiceScript } from '@borradh-workspace/database';

// Template variable definitions for AI voice caller scripts
export const TEMPLATE_VARIABLES = [
  {
    key: 'contact.first_name',
    label: 'First Name',
    description: "Lead's first name",
  },
  {
    key: 'contact.last_name',
    label: 'Last Name',
    description: "Lead's last name",
  },
  { key: 'contact.email', label: 'Email', description: "Lead's email address" },
  { key: 'contact.phone', label: 'Phone', description: "Lead's phone number" },
  {
    key: 'organization.name',
    label: 'Company Name',
    description: 'Your organization name',
  },
  {
    key: 'appointment.date',
    label: 'Appointment Date',
    description: 'Scheduled appointment date',
  },
  {
    key: 'appointment.time',
    label: 'Appointment Time',
    description: 'Scheduled appointment time',
  },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];
