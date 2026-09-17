'use client';

import { Button } from '@/components/ui/button';
import { useCallback, useEffect, useRef, useState } from 'react';

interface SignaturePadProps {
  /** Called with a PNG data URL whenever the drawing changes, or null when cleared. */
  onChange: (dataUrl: string | null) => void;
  disabled?: boolean;
}

/**
 * A self-contained drawn-signature capture — plain <canvas> + pointer events,
 * no external library (the public page must stay CSP-safe / self-contained).
 *
 * Produces a PNG `dataUrl` on every stroke end, which is exactly the shape the
 * backend stores for a signature answer (`{ dataUrl, signedAt }` — `signedAt`
 * is stamped at submit time).
 */
export function SignaturePad({ onChange, disabled }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [isEmpty, setIsEmpty] = useState(true);

  // Size the backing store to the element so strokes aren't stretched.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, []);

  const pointFromEvent = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: 0, y: 0 };
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    },
    []
  );

  const start = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (disabled) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      drawing.current = true;
      const { x, y } = pointFromEvent(e);
      ctx.beginPath();
      ctx.moveTo(x, y);
      canvasRef.current?.setPointerCapture(e.pointerId);
    },
    [disabled, pointFromEvent]
  );

  const move = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!drawing.current) return;
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      const { x, y } = pointFromEvent(e);
      ctx.lineTo(x, y);
      ctx.stroke();
      hasInk.current = true;
    },
    [pointFromEvent]
  );

  const end = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current) {
      setIsEmpty(false);
      onChange(canvasRef.current?.toDataURL('image/png') ?? null);
    }
  }, [onChange]);

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setIsEmpty(true);
    onChange(null);
  }, [onChange]);

  return (
    <div className="space-y-2">
      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="h-40 w-full touch-none rounded-md border border-input bg-background"
        aria-label="Signature pad"
      />
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">
          {isEmpty ? 'Sign above with your finger or mouse' : 'Signed'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={clear}
          disabled={disabled || isEmpty}
        >
          Clear
        </Button>
      </div>
    </div>
  );
}
