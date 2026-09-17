export * from './api';
// NOT re-exported: `./create`. Its shared field components pull in LeadPicker →
// leads → providers → the router, which would drag the whole route tree into
// every consumer of this barrel (it broke the sales page tests). Import the
// create core directly from '@/features/appointments/create'.
export {
  AppointmentQuickActions,
  type AppointmentQuickActionsProps,
} from './components/appointment-quick-actions';
export {
  AppointmentStatusProgression,
  APPOINTMENT_STATUS_OPTIONS,
} from './components/appointment-status-progression';
export {
  DepositBadge,
  DepositDetailRow,
  type DepositSummary,
  readDepositFromMetadata,
} from './components/deposit-badge';
