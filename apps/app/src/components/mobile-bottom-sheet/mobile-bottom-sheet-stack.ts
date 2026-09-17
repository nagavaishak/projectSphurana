import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
  getLayoutViewportHeight,
  subscribeVisualViewportChanges,
} from './visual-viewport-keyboard';

/** Matches `CustomSheet` Android defaults in `apps/mobile`. */
export const MOBILE_BOTTOM_SHEET_STACK = {
  parentScaleWhenStacked: 0.95,
  /**
   * Parent lift = `(1 - scale) × sheetHeight × factor`, clamped.
   * Tuned for ~30px on a ~844px-tall phone at `baseHeightFraction`.
   */
  parentLiftFromShrinkFactor: 0.73,
  parentLiftMinPx: 22,
  parentLiftMaxPx: 44,
  depthHeightStep: 0.03,
  minHeightFraction: 0.72,
  baseHeightFraction: 0.975,
} as const;

const SSR_VIEWPORT_HEIGHT_PX = 844;

/**
 * Upward lift for a parent sheet when a child is stacked above it.
 * Scales with viewport and this sheet's height fraction (not a fixed 10px).
 */
export function getStackParentLiftPx(
  viewportHeight: number,
  heightFraction: number
): number {
  const {
    parentScaleWhenStacked,
    parentLiftFromShrinkFactor,
    parentLiftMinPx,
    parentLiftMaxPx,
  } = MOBILE_BOTTOM_SHEET_STACK;
  const sheetHeight = viewportHeight * heightFraction;
  const shrink = 1 - parentScaleWhenStacked;
  const raw = shrink * sheetHeight * parentLiftFromShrinkFactor;
  return Math.round(Math.min(parentLiftMaxPx, Math.max(parentLiftMinPx, raw)));
}

function readViewportHeight(): number {
  if (typeof window === 'undefined') return SSR_VIEWPORT_HEIGHT_PX;
  return getLayoutViewportHeight();
}

/** Visual viewport height (updates on resize / mobile browser chrome). */
export function useVisualViewportHeight(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === 'undefined') return () => {};
      let prev = readViewportHeight();
      return subscribeVisualViewportChanges(() => {
        const next = readViewportHeight();
        if (next === prev) {
          return;
        }
        prev = next;
        onStoreChange();
      });
    },
    readViewportHeight,
    () => SSR_VIEWPORT_HEIGHT_PX
  );
}

let sheetIdCounter = 1;
const visibleSheetOrder: number[] = [];
const sheetStackOptions = new Map<number, MobileBottomSheetStackOptions>();
const subscribers = new Set<() => void>();
let stackVersion = 0;

function emitStackChange() {
  stackVersion += 1;
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function subscribeStack(onStoreChange: () => void) {
  subscribers.add(onStoreChange);
  return () => {
    subscribers.delete(onStoreChange);
  };
}

function getStackSnapshot() {
  return stackVersion;
}

function addVisibleSheet(id: number) {
  if (visibleSheetOrder.includes(id)) return;
  visibleSheetOrder.push(id);
  emitStackChange();
}

function removeVisibleSheet(id: number) {
  const index = visibleSheetOrder.indexOf(id);
  if (index === -1) return;
  visibleSheetOrder.splice(index, 1);
  emitStackChange();
}

function getVisibleSheetDepth(id: number): number {
  const index = visibleSheetOrder.indexOf(id);
  return index >= 0 ? index + 1 : 1;
}

function getVisibleSheetCount(): number {
  return visibleSheetOrder.length;
}

function allocateSheetId(): number {
  return sheetIdCounter++;
}

export interface MobileBottomSheetStackState {
  depth: number;
  visibleCount: number;
  hasChildAbove: boolean;
  /** Sheet height as a fraction of viewport (deeper sheets are slightly shorter). */
  heightFraction: number;
}

export interface MobileBottomSheetStackOptions {
  /** Sheet height follows content — use measured fraction when available. */
  contentBased?: boolean;
  /** Measured panel height ÷ viewport height (0–1). */
  measuredHeightFraction?: number;
}

function computeStackState(
  sheetId: number,
  isOpen: boolean,
  options?: MobileBottomSheetStackOptions
): MobileBottomSheetStackState {
  if (!isOpen || !visibleSheetOrder.includes(sheetId)) {
    return {
      depth: 1,
      visibleCount: 0,
      hasChildAbove: false,
      heightFraction: MOBILE_BOTTOM_SHEET_STACK.baseHeightFraction,
    };
  }

  const depth = getVisibleSheetDepth(sheetId);
  const visibleCount = getVisibleSheetCount();
  const reduction =
    Math.max(0, depth - 1) * MOBILE_BOTTOM_SHEET_STACK.depthHeightStep;

  const defaultFraction = Math.max(
    MOBILE_BOTTOM_SHEET_STACK.minHeightFraction,
    MOBILE_BOTTOM_SHEET_STACK.baseHeightFraction - reduction
  );

  const measured = options?.measuredHeightFraction;
  const heightFraction =
    options?.contentBased && measured != null && measured > 0
      ? Math.min(MOBILE_BOTTOM_SHEET_STACK.baseHeightFraction, measured)
      : defaultFraction;

  return {
    depth,
    visibleCount,
    hasChildAbove: visibleCount > depth,
    heightFraction,
  };
}

/**
 * Tracks open bottom sheets globally so parents scale/lift when a child sheet opens
 * (parity with `apps/mobile` `CustomSheet`).
 */
export function useMobileBottomSheetStack(
  open: boolean,
  options?: MobileBottomSheetStackOptions
): MobileBottomSheetStackState {
  const sheetIdRef = useRef<number | null>(null);
  if (sheetIdRef.current === null) {
    sheetIdRef.current = allocateSheetId();
  }
  const sheetId = sheetIdRef.current;

  useSyncExternalStore(subscribeStack, getStackSnapshot, getStackSnapshot);

  useEffect(() => {
    if (!options?.contentBased) {
      if (sheetStackOptions.delete(sheetId)) {
        emitStackChange();
      }
      return;
    }
    const prev = sheetStackOptions.get(sheetId);
    const next: MobileBottomSheetStackOptions = {
      contentBased: true,
      measuredHeightFraction: options.measuredHeightFraction,
    };
    if (
      prev?.contentBased === next.contentBased &&
      prev?.measuredHeightFraction === next.measuredHeightFraction
    ) {
      return;
    }
    sheetStackOptions.set(sheetId, next);
    emitStackChange();
  }, [sheetId, options?.contentBased, options?.measuredHeightFraction]);

  useEffect(() => {
    if (!open) {
      removeVisibleSheet(sheetId);
      return;
    }
    addVisibleSheet(sheetId);
    return () => {
      removeVisibleSheet(sheetId);
    };
  }, [open, sheetId]);

  return computeStackState(sheetId, open, sheetStackOptions.get(sheetId));
}
