import { CreativePreview } from '@/components/ui/creative-preview';
import { cn } from '@/lib/utils';
import { useState } from 'react';

export interface VariantProps {
  videoUrl?: string | null;
  imageUrl?: string | null;
  alt?: string;
  /** Intrinsic dimensions when the server already knows them. */
  width?: number | null;
  height?: number | null;
  maxHeightPx?: number;
}

/** Aspect used before the real one is known — the most common creative shape. */
const FALLBACK_ASPECT = 4 / 5;
/** Below this, a source is a thumbnail, not a creative: don't blow it up. */
const LOW_RES_MAX_EDGE = 320;

/** A: current production component (natural-size image, aspect-ratio video). */
export function VariantCurrent({
  videoUrl,
  imageUrl,
  alt,
  maxHeightPx = 520,
}: VariantProps) {
  const [videoAspect, setVideoAspect] = useState<number | null>(null);
  if (videoUrl) {
    return (
      <div
        className="relative mx-auto w-full overflow-hidden rounded-lg border bg-muted"
        style={{ aspectRatio: videoAspect ?? 1, maxHeight: maxHeightPx }}
      >
        {/* biome-ignore lint/a11y/useMediaCaption: lab */}
        <video
          src={videoUrl}
          className="h-full w-full object-contain"
          controls
          playsInline
          preload="metadata"
          poster={imageUrl ?? undefined}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth) setVideoAspect(v.videoWidth / v.videoHeight);
          }}
        />
      </div>
    );
  }
  return (
    <div className="flex justify-center overflow-hidden rounded-lg border bg-muted">
      <img
        src={imageUrl ?? undefined}
        alt={alt}
        className="block max-w-full"
        style={{ maxHeight: maxHeightPx }}
      />
    </div>
  );
}

/** B: shrink-0 only — isolates how much of the damage is the flex squash. */
export function VariantShrinkFix(props: VariantProps) {
  return (
    <div className="shrink-0">
      <VariantCurrent {...props} />
    </div>
  );
}

/**
 * C: aspect-locked frame. One code path for image and video: the frame takes
 * the creative's real aspect ratio (from props, else measured), the media is
 * `object-contain` inside it, and the whole thing never shrinks.
 */
export function VariantAspectFrame({
  videoUrl,
  imageUrl,
  alt,
  width,
  height,
  maxHeightPx = 520,
}: VariantProps) {
  const [measured, setMeasured] = useState<number | null>(null);
  const known = width && height ? width / height : null;
  const aspect = known ?? measured ?? FALLBACK_ASPECT;

  return (
    <div
      className="relative w-full shrink-0 overflow-hidden rounded-lg border bg-muted"
      style={{ aspectRatio: aspect, maxHeight: maxHeightPx }}
    >
      {videoUrl ? (
        // biome-ignore lint/a11y/useMediaCaption: lab
        <video
          src={videoUrl}
          className="absolute inset-0 h-full w-full object-contain"
          controls
          playsInline
          preload="metadata"
          poster={imageUrl ?? undefined}
          onLoadedMetadata={(e) => {
            const v = e.currentTarget;
            if (v.videoWidth) setMeasured(v.videoWidth / v.videoHeight);
          }}
        />
      ) : (
        <img
          src={imageUrl ?? undefined}
          alt={alt}
          className="absolute inset-0 h-full w-full object-contain"
          onLoad={(e) => {
            const i = e.currentTarget;
            if (i.naturalWidth) setMeasured(i.naturalWidth / i.naturalHeight);
          }}
        />
      )}
    </div>
  );
}

/**
 * D: aspect-locked frame + low-resolution guard. A 64x64 Meta thumbnail gets a
 * small frame sized to what the pixels can actually carry, instead of a
 * full-width box with a postage stamp in it.
 */
export function VariantAspectFrameLowRes({
  videoUrl,
  imageUrl,
  alt,
  width,
  height,
  maxHeightPx = 520,
}: VariantProps) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null
  );
  const w = width ?? measured?.w ?? null;
  const h = height ?? measured?.h ?? null;
  const aspect = w && h ? w / h : FALLBACK_ASPECT;
  const maxEdge = w && h ? Math.max(w, h) : null;
  const lowRes = !videoUrl && maxEdge !== null && maxEdge <= LOW_RES_MAX_EDGE;

  return (
    <div className="shrink-0">
      <div
        className={cn(
          'relative overflow-hidden rounded-lg border bg-muted',
          lowRes ? 'mx-auto' : 'w-full'
        )}
        style={
          lowRes
            ? { width: Math.min((w as number) * 2, 240), aspectRatio: aspect }
            : { aspectRatio: aspect, maxHeight: maxHeightPx }
        }
      >
        {videoUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: lab
          <video
            src={videoUrl}
            className="absolute inset-0 h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            poster={imageUrl ?? undefined}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth)
                setMeasured({ w: v.videoWidth, h: v.videoHeight });
            }}
          />
        ) : (
          <img
            src={imageUrl ?? undefined}
            alt={alt}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth)
                setMeasured({ w: i.naturalWidth, h: i.naturalHeight });
            }}
          />
        )}
      </div>
      {lowRes ? (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Low-resolution preview from Meta ({w}×{h})
        </p>
      ) : null}
    </div>
  );
}

/** E: D, but the frame is height-driven so every creative reads at one size. */
export function VariantFixedHeight({
  videoUrl,
  imageUrl,
  alt,
  width,
  height,
  maxHeightPx = 420,
}: VariantProps) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null
  );
  const w = width ?? measured?.w ?? null;
  const h = height ?? measured?.h ?? null;
  const aspect = w && h ? w / h : FALLBACK_ASPECT;
  const maxEdge = w && h ? Math.max(w, h) : null;
  const lowRes = !videoUrl && maxEdge !== null && maxEdge <= LOW_RES_MAX_EDGE;
  const frameHeight = lowRes ? Math.min((h as number) * 2, 200) : maxHeightPx;

  return (
    <div className="shrink-0">
      <div
        className="relative mx-auto overflow-hidden rounded-lg border bg-muted"
        style={{ height: frameHeight, aspectRatio: aspect, maxWidth: '100%' }}
      >
        {videoUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: lab
          <video
            src={videoUrl}
            className="absolute inset-0 h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            poster={imageUrl ?? undefined}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth)
                setMeasured({ w: v.videoWidth, h: v.videoHeight });
            }}
          />
        ) : (
          <img
            src={imageUrl ?? undefined}
            alt={alt}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth)
                setMeasured({ w: i.naturalWidth, h: i.naturalHeight });
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * F: the frame is sized to the creative's real shape and is as large as it can
 * be inside BOTH bounds — the panel width and the height cap. Setting the width
 * to `maxHeight * aspect` and clamping it with `max-width: 100%` lets the
 * aspect ratio derive the height in every case, so no shape ever letterboxes:
 * a 9:16 gets a tall narrow frame, a 4:5 fills the width, a 1:1 fills the width.
 */
export function VariantBestFit({
  videoUrl,
  imageUrl,
  alt,
  width,
  height,
  maxHeightPx = 520,
}: VariantProps) {
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(
    null
  );
  const w = width ?? measured?.w ?? null;
  const h = height ?? measured?.h ?? null;
  const aspect = w && h ? w / h : FALLBACK_ASPECT;
  const maxEdge = w && h ? Math.max(w, h) : null;
  const lowRes = !videoUrl && maxEdge !== null && maxEdge <= LOW_RES_MAX_EDGE;

  const frameStyle: React.CSSProperties = lowRes
    ? { width: Math.min((w as number) * 2, 240), aspectRatio: aspect }
    : {
        aspectRatio: aspect,
        width: maxHeightPx * aspect,
        maxWidth: '100%',
        maxHeight: maxHeightPx,
      };

  return (
    <div className="shrink-0">
      <div
        className="relative mx-auto overflow-hidden rounded-lg border bg-muted"
        style={frameStyle}
      >
        {videoUrl ? (
          // biome-ignore lint/a11y/useMediaCaption: lab
          <video
            src={videoUrl}
            className="absolute inset-0 h-full w-full object-contain"
            controls
            playsInline
            preload="metadata"
            poster={imageUrl ?? undefined}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth)
                setMeasured({ w: v.videoWidth, h: v.videoHeight });
            }}
          />
        ) : (
          <img
            src={imageUrl ?? undefined}
            alt={alt}
            className="absolute inset-0 h-full w-full object-contain"
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth)
                setMeasured({ w: i.naturalWidth, h: i.naturalHeight });
            }}
          />
        )}
      </div>
      {lowRes ? (
        <p className="mt-1 text-center text-[11px] text-muted-foreground">
          Low-resolution preview from Meta ({w}×{h})
        </p>
      ) : null}
    </div>
  );
}

export const VARIANTS = {
  A_current: VariantCurrent,
  B_shrink0: VariantShrinkFix,
  C_aspectFrame: VariantAspectFrame,
  D_aspectFrameLowRes: VariantAspectFrameLowRes,
  E_fixedHeight: VariantFixedHeight,
  F_bestFit: VariantBestFit,
  SHIPPED: CreativePreview,
} as const;

export type VariantKey = keyof typeof VARIANTS;
