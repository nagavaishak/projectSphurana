import type { LeadStageGroup } from '@borradh-workspace/labels';

/**
 * The Clients tab strip. Order and labels are UI concerns; the backend stage
 * groups are `all | leads | contacted | booked`. Each `value` is passed to the
 * `stageGroup` query param — `all` applies no filter server-side, and the
 * `contacted` group also covers `qualified` (see `leadStageGroups`).
 */
export const STAGE_GROUP_TABS: readonly {
  value: LeadStageGroup;
  label: string;
}[] = [
  { value: 'all', label: 'All' },
  { value: 'leads', label: 'Leads' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'booked', label: 'Booked' },
];
