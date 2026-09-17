import path from 'node:path';
import {
  type ApiSurface,
  type MutatingEndpoint,
  collectMutatingEndpoints,
} from './api-surface.js';
import {
  PORT_COVERAGE,
  UNCOVERED_BASELINE,
  WAIVERS,
  type WaiverRule,
} from './endpoint-coverage.manifest.js';
import { type PortSurface, collectPortMethods } from './port-surface.js';

/**
 * Gate 1's classifier: every mutating endpoint is ported, waived, or uncovered.
 * The gate and the baseline regenerator (`UPDATE_ENDPOINT_BASELINE=1`) both read
 * this one report, so the list you baseline is produced by the code that grades
 * it — a divergence there would silently re-open the gate.
 */

export type Coverage =
  | { kind: 'port'; method: string }
  | { kind: 'waived'; rule: WaiverRule }
  | { kind: 'uncovered' };

export interface ClassifiedEndpoint extends MutatingEndpoint {
  coverage: Coverage;
}

/** `apps/api/src/architecture` → repo root. */
export const REPO_ROOT = path.resolve(__dirname, '../../../../');
export const API_SRC_DIR = path.join(REPO_ROOT, 'apps/api/src');
export const PORTS_DIR = path.join(REPO_ROOT, 'packages/contracts/src/ports');

function matches(endpoint: MutatingEndpoint, rule: WaiverRule): boolean {
  const target = rule.match.startsWith('/')
    ? endpoint.route
    : `${endpoint.verb} ${endpoint.route}`;
  const needle = rule.match.replace(/\/+$/, '');
  return target === needle || target.startsWith(`${needle}/`);
}

/** First matching rule wins, so narrow `waived: false` rules can precede broad ones. */
export function findWaiver(endpoint: MutatingEndpoint): WaiverRule | null {
  for (const rule of WAIVERS) {
    if (!matches(endpoint, rule)) continue;
    return rule.waived === false ? null : rule;
  }
  return null;
}

export function classify(endpoint: MutatingEndpoint): Coverage {
  const method = PORT_COVERAGE[endpoint.id];
  if (method) return { kind: 'port', method };

  const rule = findWaiver(endpoint);
  if (rule) return { kind: 'waived', rule };

  return { kind: 'uncovered' };
}

export interface CoverageReport {
  surface: ApiSurface;
  ports: PortSurface;
  endpoints: ClassifiedEndpoint[];
  ported: ClassifiedEndpoint[];
  waived: ClassifiedEndpoint[];
  uncovered: ClassifiedEndpoint[];
  /** Uncovered endpoints absent from the ratchet baseline — these fail the gate. */
  newlyUncovered: string[];
  /** Baseline entries that are no longer uncovered — the ratchet must shrink. */
  staleBaseline: string[];
  /** `PORT_COVERAGE` values naming a port method that does not exist. */
  unknownPortMethods: string[];
}

export function buildCoverageReport(): CoverageReport {
  const surface = collectMutatingEndpoints(API_SRC_DIR, REPO_ROOT);
  const ports = collectPortMethods(PORTS_DIR);

  const endpoints: ClassifiedEndpoint[] = surface.endpoints.map((e) => ({
    ...e,
    coverage: classify(e),
  }));

  const ported = endpoints.filter((e) => e.coverage.kind === 'port');
  const waived = endpoints.filter((e) => e.coverage.kind === 'waived');
  const uncovered = endpoints.filter((e) => e.coverage.kind === 'uncovered');
  const uncoveredIds = new Set(uncovered.map((e) => e.id));

  return {
    surface,
    ports,
    endpoints,
    ported,
    waived,
    uncovered,
    newlyUncovered: uncovered
      .map((e) => e.id)
      .filter((id) => !UNCOVERED_BASELINE.has(id))
      .sort(),
    staleBaseline: [...UNCOVERED_BASELINE]
      .filter((id) => !uncoveredIds.has(id))
      .sort(),
    unknownPortMethods: [
      ...new Set(
        Object.values(PORT_COVERAGE).filter(
          (method) => !ports.methods.has(method)
        )
      ),
    ].sort(),
  };
}

/** Uncovered endpoints grouped by their top-level path segment, biggest first. */
export function groupUncoveredByArea(
  uncovered: ClassifiedEndpoint[]
): { area: string; ids: string[] }[] {
  const byArea = new Map<string, string[]>();
  for (const e of uncovered) {
    const area = e.route.split('/').filter(Boolean)[0] ?? '(root)';
    const list = byArea.get(area) ?? [];
    list.push(e.id);
    byArea.set(area, list);
  }
  return [...byArea.entries()]
    .map(([area, ids]) => ({ area, ids: ids.sort() }))
    .sort(
      (a, b) => b.ids.length - a.ids.length || a.area.localeCompare(b.area)
    );
}
