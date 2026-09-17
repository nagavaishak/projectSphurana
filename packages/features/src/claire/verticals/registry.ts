import type { BusinessVertical } from '@borradh-workspace/database';
import { aestheticClinicConfig } from './aesthetic-clinic/index.js';
import type { VerticalConfig } from './types.js';

export const verticalRegistry = new Map<BusinessVertical, VerticalConfig>([
  ['aesthetic_clinic', aestheticClinicConfig],
]);

export const getVerticalConfig = (
  vertical: BusinessVertical
): VerticalConfig => {
  const config = verticalRegistry.get(vertical);
  if (!config) {
    throw new Error(`No VerticalConfig registered for vertical: ${vertical}`);
  }
  return config;
};
