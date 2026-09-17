import type {
  Experiment,
  ExperimentAssignment,
  ExperimentVariantConfig,
} from '@borradh-workspace/database';

export type { Experiment, ExperimentAssignment, ExperimentVariantConfig };

/**
 * Result of resolving an experiment variant for an organization.
 * Returns null if no active experiment exists for the given key.
 */
export interface ResolvedVariant {
  experimentId: string;
  variant: string;
}
