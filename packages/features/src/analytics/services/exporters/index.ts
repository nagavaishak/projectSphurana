export type { DomainExporter } from './types.js';
export { conversationsExporter } from './conversations.exporter.js';
export { leadsExporter } from './leads.exporter.js';
export { campaignsExporter } from './campaigns.exporter.js';
export { appointmentsExporter } from './appointments.exporter.js';
export { billingExporter } from './billing.exporter.js';
export { servicesExporter } from './services.exporter.js';

import { appointmentsExporter } from './appointments.exporter.js';
import { billingExporter } from './billing.exporter.js';
import { campaignsExporter } from './campaigns.exporter.js';
import { conversationsExporter } from './conversations.exporter.js';
import { leadsExporter } from './leads.exporter.js';
import { servicesExporter } from './services.exporter.js';
import type { DomainExporter } from './types.js';

/** All registered domain exporters. Add new exporters here. */
export const allExporters: DomainExporter[] = [
  conversationsExporter,
  leadsExporter,
  campaignsExporter,
  appointmentsExporter,
  billingExporter,
  servicesExporter,
];
