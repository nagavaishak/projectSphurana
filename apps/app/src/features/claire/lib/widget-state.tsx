import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Shared client state for the Claire widget.
 *
 * Consumed by:
 *   - W8  (launcher)              — reads `isOpen`, `isTourRunning`; writes `setOpen`
 *   - W9  (chat panel)            — reads `isOpen`
 *   - W10 (recommendation toast)  — reads `isOpen`, `isTourRunning`
 *   - W12 (tour runner)           — writes `setTourRunning` on start/end
 *
 * Rules:
 *   - `isOpen` persists to localStorage so the widget stays open across
 *     page navigations (per claire-owner-spec.md §4.3).
 *   - `isTourRunning` is ephemeral — never persisted. While true, the
 *     widget launcher + panel hide themselves so the tour's Claire chatbox
 *     is the only Claire presence on screen (per claire-spec-v2.md D6).
 */

interface ClaireWidgetState {
  isOpen: boolean;
  setOpen: (open: boolean) => void;
  toggleOpen: () => void;
  isTourRunning: boolean;
  setTourRunning: (running: boolean) => void;
}

export const useClaireWidgetState = create<ClaireWidgetState>()(
  persist(
    (set) => ({
      isOpen: false,
      setOpen: (open) => set({ isOpen: open }),
      toggleOpen: () => set((state) => ({ isOpen: !state.isOpen })),
      isTourRunning: false,
      setTourRunning: (running) => set({ isTourRunning: running }),
    }),
    {
      name: 'claire-widget-state',
      // Only persist `isOpen`. `isTourRunning` is session-local and should
      // never survive a reload (a refresh mid-tour cancels it).
      partialize: (state) => ({ isOpen: state.isOpen }),
    }
  )
);
