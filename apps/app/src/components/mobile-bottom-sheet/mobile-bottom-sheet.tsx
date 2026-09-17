import { mobileNavEase } from '@/features/mobile-bottom-tabs/mobile-bottom-tabs-motion';
import { cn } from '@/lib/utils';
import type { CSSProperties, ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import { Drawer } from 'vaul';

import {
  MOBILE_BOTTOM_SHEET_STACK,
  getStackParentLiftPx,
  useMobileBottomSheetStack,
  useVisualViewportHeight,
} from './mobile-bottom-sheet-stack';
import { useVisualViewportKeyboardInset } from './use-visual-viewport-keyboard-inset';

const DEFAULT_Z_CLASS = 'z-[100]';
const STACK_TRANSITION_MS = 480;

const SHEET_SURFACE_CLASS =
  'flex w-full flex-col rounded-t-[22px] border-t border-[#ECECEC] bg-white shadow-[0_-4px_14px_rgba(0,0,0,0.1)] pb-[max(12px,env(safe-area-inset-bottom,0px))] pt-2.5 will-change-transform';

const SHEET_SURFACE_FULL_HEIGHT_CLASS = 'h-full min-h-0';
const SHEET_SURFACE_CONTENT_HEIGHT_CLASS = 'h-auto min-h-0';

/** Cap for content-based sheets so tall bodies can still scroll inside. */
const CONTENT_BASED_MAX_HEIGHT =
  'min(90dvh, calc(100dvh - env(safe-area-inset-top, 0px) - 24px))';

export interface MobileBottomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Accessible title (visually hidden unless `titleClassName` overrides). */
  title: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  overlayClassName?: string;
  titleClassName?: string;
  style?: CSSProperties;
  /** Stacking order for nested sheets (overlay + panel). Default `z-[100]`. */
  zClass?: string;
  /** When true, increases bottom padding while the on-screen keyboard is open. */
  keyboardAware?: boolean;
  /** Drag handle pill at the top of the sheet. */
  showDragHandle?: boolean;
  shouldScaleBackground?: boolean;
  /** Participate in iOS-style stacked sheet transforms (default true). */
  enableStackEffect?: boolean;
  /**
   * Size the sheet to its content instead of a near-full viewport height.
   * Capped at ~90dvh; use an inner scroll region if content can grow taller.
   */
  contentBased?: boolean;
}

/**
 * Vaul-based mobile bottom sheet — shared chrome (overlay, rounded panel, handle,
 * safe-area). Feature screens supply their own body via `children`.
 */
export function MobileBottomSheet({
  open,
  onOpenChange,
  title,
  children,
  className,
  contentClassName,
  overlayClassName,
  titleClassName = 'sr-only',
  style,
  zClass = DEFAULT_Z_CLASS,
  keyboardAware = false,
  showDragHandle = true,
  shouldScaleBackground = false,
  enableStackEffect = true,
  contentBased = false,
}: MobileBottomSheetProps) {
  const keyboardInset = useVisualViewportKeyboardInset();
  const viewportHeight = useVisualViewportHeight();
  const sheetSurfaceRef = useRef<HTMLDivElement>(null);
  const [measuredHeightFraction, setMeasuredHeightFraction] = useState<
    number | undefined
  >(undefined);

  useLayoutEffect(() => {
    if (!contentBased || !open) {
      setMeasuredHeightFraction(undefined);
      return;
    }

    const node = sheetSurfaceRef.current;
    if (!node) {
      return;
    }

    const measure = () => {
      const height = node.getBoundingClientRect().height;
      if (height <= 0 || viewportHeight <= 0) {
        return;
      }
      setMeasuredHeightFraction(height / viewportHeight);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [contentBased, open, viewportHeight]);

  const stack = useMobileBottomSheetStack(enableStackEffect && open, {
    contentBased,
    measuredHeightFraction,
  });
  const parentLiftPx = getStackParentLiftPx(
    viewportHeight,
    stack.heightFraction
  );

  // Keyboard handling: lift the whole sheet so its bottom edge rests on the
  // top of the keyboard, and shrink it by the same amount so the top stays
  // put. The sheet panel then ends exactly at the keyboard — the composer
  // sits just above it with no white gap below. vaul's own input
  // repositioning is disabled for keyboardAware sheets so the inset is
  // applied once.
  const keyboardLift = keyboardAware && keyboardInset > 0 ? keyboardInset : 0;

  const shellHeightPx = Math.round(stack.heightFraction * viewportHeight);
  const hasChildAbove = enableStackEffect && stack.hasChildAbove;

  // Lift via `bottom` (vaul drives open/close with `transform`, so the two
  // don't collide).
  const keyboardTransition = `bottom ${STACK_TRANSITION_MS}ms ${mobileNavEase}`;

  /** Positioning shell — Vaul may animate this; visual sheet lives in `sheetSurface`. */
  const shellStyle: CSSProperties = contentBased
    ? {
        ...style,
        height: 'auto',
        maxHeight: keyboardLift
          ? `calc(${CONTENT_BASED_MAX_HEIGHT} - ${keyboardLift}px)`
          : CONTENT_BASED_MAX_HEIGHT,
        bottom: keyboardLift || undefined,
        transition: keyboardTransition,
      }
    : {
        ...style,
        height: Math.max(0, shellHeightPx - keyboardLift),
        maxHeight: Math.max(0, shellHeightPx - keyboardLift),
        bottom: keyboardLift || undefined,
        transition: `height ${STACK_TRANSITION_MS}ms ${mobileNavEase}, max-height ${STACK_TRANSITION_MS}ms ${mobileNavEase}, ${keyboardTransition}`,
      };

  /** Full panel chrome + stack transform (parity with RN `CustomSheet` sheet view). */
  const sheetSurfaceStyle: CSSProperties = enableStackEffect
    ? {
        transformOrigin: 'bottom center',
        transition: `transform ${STACK_TRANSITION_MS}ms ${mobileNavEase}`,
        transform: hasChildAbove
          ? `scale(${MOBILE_BOTTOM_SHEET_STACK.parentScaleWhenStacked}) translateY(-${parentLiftPx}px)`
          : 'scale(1) translateY(0)',
      }
    : {};

  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      shouldScaleBackground={shouldScaleBackground}
      // keyboardAware sheets lift their own content above the keyboard
      // (keyboardBottomPad). Let vaul reposition inputs only for sheets that
      // don't — running both stacks the keyboard inset twice.
      repositionInputs={!keyboardAware}
    >
      <Drawer.Portal>
        <Drawer.Overlay
          className={cn(
            'fixed inset-0 bg-black/30 transition-opacity duration-300',
            hasChildAbove && 'pointer-events-none opacity-0',
            zClass,
            overlayClassName
          )}
        />
        <Drawer.Content
          className={cn(
            'fixed inset-x-0 bottom-0 flex flex-col bg-transparent p-0 shadow-none outline-none',
            contentBased ? 'h-auto min-h-0' : 'min-h-[240px]',
            hasChildAbove ? 'overflow-visible' : 'overflow-hidden',
            zClass,
            className
          )}
          style={shellStyle}
        >
          <div
            ref={sheetSurfaceRef}
            className={cn(
              SHEET_SURFACE_CLASS,
              contentBased
                ? SHEET_SURFACE_CONTENT_HEIGHT_CLASS
                : SHEET_SURFACE_FULL_HEIGHT_CLASS,
              contentBased && !hasChildAbove && 'max-h-full overflow-y-auto',
              hasChildAbove
                ? 'overflow-visible'
                : !contentBased && 'overflow-hidden',
              contentClassName
            )}
            style={sheetSurfaceStyle}
          >
            <Drawer.Title className={titleClassName}>{title}</Drawer.Title>

            {showDragHandle ? (
              <div className="flex shrink-0 flex-col items-center pt-0.5 pb-2">
                <div
                  className="h-1 w-8 shrink-0 rounded-full bg-[#C7C7CC]"
                  aria-hidden
                />
              </div>
            ) : null}

            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
