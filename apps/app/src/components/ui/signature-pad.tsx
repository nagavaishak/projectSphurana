import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Hand-rolled canvas signature box (no dependency).
 *
 * - Pointer events (mouse + touch + pen) with pointer capture, so a stroke
 *   that wanders outside the box keeps drawing.
 * - devicePixelRatio-scaled backing store for crisp ink on retina screens.
 * - Quadratic midpoint smoothing (curve through midpoints, control at the
 *   sampled point) — the standard trick for smooth freehand strokes.
 * - Transparent background, near-black ink; a dashed baseline with a small
 *   ✕ marker like a real signature box.
 *
 * Accessibility: drawing on a canvas is pointer-only, which locks out
 * keyboard- and motor-impaired users from a legally-required signature. When
 * `typedValue` is provided, a "Type" mode renders that text into the canvas in
 * a script font and emits the same PNG — a fully keyboard-operable path to a
 * valid signature. The mode toggle is a normal focusable control.
 *
 * `onChange` fires with a PNG data URL (end of each stroke / on each typed
 * keystroke in Type mode) and with `null` on Clear or an empty typed value.
 */

export function isSignatureEmpty(value: string | null): boolean {
  return value === null;
}

type SignatureMode = 'draw' | 'type';

interface SignaturePadProps {
  onChange?: (dataUrl: string | null) => void;
  className?: string;
  'aria-describedby'?: string;
  /**
   * When provided, enables the keyboard-accessible "Type" mode: this text is
   * rendered into the canvas as a script-font signature. Wire it to the same
   * "type your full name" field the form already collects.
   */
  typedValue?: string;
}

export function SignaturePad({
  onChange,
  className,
  'aria-describedby': ariaDescribedBy,
  typedValue,
}: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  /** Last sampled point and the last midpoint, in CSS pixels. */
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastMidRef = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  const [mode, setMode] = useState<SignatureMode>('draw');
  const canType = typedValue !== undefined;

  // Size the backing store to CSS size × devicePixelRatio. Re-runs on
  // container resize (an existing drawing is intentionally not preserved
  // through a resize — same trade-off real signature pads make).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const applySize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // Canvas can't resolve the `currentColor` keyword — read the
        // computed CSS color (near-black, flips in dark mode).
        ctx.strokeStyle = getComputedStyle(canvas).color;
      }
    };

    applySize();
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = pointFromEvent(event);
    lastPointRef.current = point;
    lastMidRef.current = point;

    // A tap should still leave a dot.
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 1, 0, Math.PI * 2);
      ctx.fillStyle = getComputedStyle(canvas).color;
      ctx.fill();
    }
    setHasInk(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext('2d');
    const last = lastPointRef.current;
    const lastMid = lastMidRef.current;
    if (!ctx || !last || !lastMid) return;

    const point = pointFromEvent(event);
    const mid = { x: (last.x + point.x) / 2, y: (last.y + point.y) / 2 };

    // Curve from the previous midpoint to the new midpoint, with the
    // previously sampled point as control — smooth through jittery samples.
    ctx.beginPath();
    ctx.moveTo(lastMid.x, lastMid.y);
    ctx.quadraticCurveTo(last.x, last.y, mid.x, mid.y);
    ctx.stroke();

    lastPointRef.current = point;
    lastMidRef.current = mid;
  };

  const endStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    lastMidRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const canvas = canvasRef.current;
    if (canvas) {
      onChange?.(canvas.toDataURL('image/png'));
    }
  };

  const clearCanvasBitmap = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (canvas && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }, []);

  const handleClear = useCallback(() => {
    clearCanvasBitmap();
    drawingRef.current = false;
    lastPointRef.current = null;
    lastMidRef.current = null;
    setHasInk(false);
    onChange?.(null);
  }, [onChange, clearCanvasBitmap]);

  // Type mode: render `typedValue` into the canvas as a script-font signature
  // and emit the PNG. Re-runs on each keystroke so the rendered signature
  // tracks the name field live. This is the keyboard-accessible path — no
  // pointer interaction required to produce a valid signature image.
  useEffect(() => {
    if (mode !== 'type') return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    clearCanvasBitmap();
    const text = (typedValue ?? '').trim();
    if (text.length === 0) {
      setHasInk(false);
      onChange?.(null);
      return;
    }

    const rect = canvas.getBoundingClientRect();
    ctx.save();
    ctx.fillStyle = getComputedStyle(canvas).color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    // Shrink the font until the rendered name fits the box width.
    let fontSize = 44;
    do {
      ctx.font = `italic ${fontSize}px 'Segoe Script', 'Snell Roundhand', 'Bradley Hand', cursive`;
      if (ctx.measureText(text).width <= rect.width - 32) break;
      fontSize -= 2;
    } while (fontSize > 14);
    ctx.fillText(text, rect.width / 2, rect.height / 2);
    ctx.restore();

    setHasInk(true);
    onChange?.(canvas.toDataURL('image/png'));
  }, [mode, typedValue, onChange, clearCanvasBitmap]);

  const switchMode = useCallback(
    (next: SignatureMode) => {
      if (next === mode) return;
      // Switching modes abandons whatever is on the pad — clear it so the two
      // input methods never composite into one image.
      clearCanvasBitmap();
      drawingRef.current = false;
      lastPointRef.current = null;
      lastMidRef.current = null;
      setHasInk(false);
      onChange?.(null);
      setMode(next);
    },
    [mode, onChange, clearCanvasBitmap]
  );

  const typeMode = mode === 'type';

  return (
    <div className="flex flex-col gap-2">
      {canType && (
        <div
          className="flex items-center gap-1 self-start rounded-md border p-0.5"
          role="group"
          aria-label="Signature input method"
        >
          <Button
            type="button"
            variant={typeMode ? 'ghost' : 'secondary'}
            size="sm"
            aria-pressed={!typeMode}
            onClick={() => switchMode('draw')}
          >
            Draw
          </Button>
          <Button
            type="button"
            variant={typeMode ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={typeMode}
            onClick={() => switchMode('type')}
          >
            Type
          </Button>
        </div>
      )}

      <div
        className={cn(
          'relative h-40 w-full rounded-lg border bg-transparent shadow-xs',
          'text-neutral-900 dark:text-neutral-100',
          className
        )}
      >
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={
            typeMode ? 'Typed signature preview' : 'Signature drawing area'
          }
          aria-describedby={ariaDescribedBy}
          className={cn(
            'size-full touch-none rounded-lg',
            typeMode && 'pointer-events-none'
          )}
          onPointerDown={typeMode ? undefined : handlePointerDown}
          onPointerMove={typeMode ? undefined : handlePointerMove}
          onPointerUp={typeMode ? undefined : endStroke}
          onPointerCancel={typeMode ? undefined : endStroke}
        />

        {/* Dashed baseline with the ✕ marker, like a paper signature box. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-6 bottom-8 flex items-end gap-2"
        >
          <span className="text-muted-foreground pb-0.5 text-xs leading-none">
            ✕
          </span>
          <span className="border-muted-foreground/40 w-full border-b border-dashed" />
        </div>

        {!hasInk && (
          <p
            aria-hidden
            className="text-muted-foreground pointer-events-none absolute inset-0 flex items-center justify-center text-sm"
          >
            {typeMode ? 'Type your name above' : 'Sign here'}
          </p>
        )}

        {hasInk && !typeMode && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground absolute top-1 right-1"
            onClick={handleClear}
          >
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
