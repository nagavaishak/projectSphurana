/** Fixtures for the entity-view shell options. Static, no queries. */

export const APPOINTMENT = {
  patient: 'Nadia Osei',
  initials: 'NO',
  service: 'Anti-wrinkle — 3 areas',
  when: 'Today, Sat 14 March · 09:00–09:45',
  practitioner: 'Dr. Aoife Byrne',
  status: 'In progress',
  statusSince: 'arrived 08:56',
  price: '£280.00',
  deposit: '£50 paid',
  balance: '£230 due at checkout',
  consent: 'Botulinum toxin — signed 13 Mar',
  room: 'Room 2',
  visitNo: 'Visit #4',
} as const;

export const CLIENT = {
  name: 'Sarah Whelan',
  initials: 'SW',
  email: 'sarah.whelan@example.com',
  phone: '+353 87 555 0142',
  since: 'Client since Nov 2024',
  lifetime: '£2,140',
  visits: 7,
  nextAppt: 'Tue 18 Mar · 14:30',
  outstanding: '1 consent form due',
} as const;

export const APPOINTMENT_TABS = [
  'Overview',
  'Clinical',
  'Payments',
  'Forms & consent',
  'Notes',
  'Activity',
] as const;

export const CLIENT_TABS = [
  'Overview',
  'Appointments',
  'Clinical',
  'Sales',
  'Memberships',
  'Forms',
  'Consent',
  'Documents',
  'Notes',
  'Details',
  'Activity',
] as const;

/** Rows for the Overview panel — label/value pairs, deliberately few. */
export const APPOINTMENT_OVERVIEW = [
  { label: 'Service', value: 'Anti-wrinkle — 3 areas · 45 min' },
  { label: 'Practitioner', value: 'Dr. Aoife Byrne' },
  { label: 'When', value: 'Saturday 14 March, 09:00–09:45' },
  { label: 'Where', value: 'Room 2 · Pelham Street, Hanley' },
  { label: 'Booked', value: '2 March, online' },
] as const;

export const CLIENT_OVERVIEW = [
  { label: 'Mobile', value: '+353 87 555 0142' },
  { label: 'Email', value: 'sarah.whelan@example.com' },
  { label: 'Date of birth', value: '4 June 1984' },
  { label: 'Address', value: '12 Pelham Street, Hanley, ST1 3LL' },
  { label: 'Source', value: 'Instagram — Sep 2024' },
] as const;
