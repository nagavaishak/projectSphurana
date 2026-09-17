import { create } from 'zustand';

/**
 * What the tracker knows about one asset whose AI analysis is in flight.
 *
 * `pending` covers both `queued` and `processing` on the server — the client
 * has no reason to distinguish them, and collapsing them keeps the upload UIs
 * from having to mirror the worker's state machine.
 */
export type TrackedAnalysisStatus =
  | 'pending'
  | 'completed'
  | 'failed'
  /**
   * The tracker stopped waiting without a terminal answer. The asset is fine
   * and may still be tagged later — this says only that we gave up watching.
   * Deliberately distinct from `failed`.
   */
  | 'abandoned';

export interface TrackedAnalysis {
  assetId: string;
  /** Filename, used only for the completion toast. */
  label: string;
  status: TrackedAnalysisStatus;
  tags: string[];
}

interface AnalysisTrackerStore {
  tracked: Record<string, TrackedAnalysis>;
  /**
   * Register assets whose analysis was just queued. Idempotent: re-registering
   * an asset already being tracked leaves its current status alone, so a
   * remount of an upload screen cannot reset a completed row back to pending.
   */
  track: (assets: Array<{ assetId: string; label: string }>) => void;
  /** Record a terminal (or abandoned) outcome from the poller. */
  settle: (
    assetId: string,
    outcome: {
      status: Exclude<TrackedAnalysisStatus, 'pending'>;
      tags?: string[];
    }
  ) => void;
  /** Stop tracking — the user deleted the asset, or we are done reporting. */
  untrack: (assetIds: string[]) => void;
}

/**
 * Analysis tracking lives here, ABOVE any upload screen, because analysis is
 * a server-owned lifecycle that outlives the dialog that started it.
 *
 * The worker persists both the analysis status and the resulting tags onto the
 * asset row (`asset-analysis-processor.ts` → `updateAssetTags`), so nothing is
 * lost when the user navigates away, closes the dialog, or reloads. This store
 * exists purely so the UI can REPORT progress from anywhere in the app, never
 * so it can own the outcome.
 */
export const useAnalysisTrackerStore = create<AnalysisTrackerStore>((set) => ({
  tracked: {},

  track: (assets) =>
    set((state) => {
      const next = { ...state.tracked };
      for (const { assetId, label } of assets) {
        if (next[assetId]) continue;
        next[assetId] = { assetId, label, status: 'pending', tags: [] };
      }
      return { tracked: next };
    }),

  settle: (assetId, outcome) =>
    set((state) => {
      const current = state.tracked[assetId];
      if (!current) return state;
      return {
        tracked: {
          ...state.tracked,
          [assetId]: {
            ...current,
            status: outcome.status,
            tags: outcome.tags ?? current.tags,
          },
        },
      };
    }),

  untrack: (assetIds) =>
    set((state) => {
      const next = { ...state.tracked };
      let changed = false;
      for (const assetId of assetIds) {
        if (next[assetId]) {
          delete next[assetId];
          changed = true;
        }
      }
      return changed ? { tracked: next } : state;
    }),
}));

/** Asset ids still waiting on the worker. */
export const selectPendingAssetIds = (state: {
  tracked: Record<string, TrackedAnalysis>;
}) =>
  Object.values(state.tracked)
    .filter((entry) => entry.status === 'pending')
    .map((entry) => entry.assetId);
