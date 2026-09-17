import type {
  RenderDoc,
  RenderOrientation,
  ResolvedBlock,
  ResolvedCaptions,
  ResolvedMusicTrack,
  ResolvedNarration,
  ResolvedRegion,
  ResolvedTypeStyle,
} from '@borradh-workspace/video-templates';
import type React from 'react';
import { AbsoluteFill, Audio, Sequence } from 'remotion';

import { getBlockRenderer } from '../blocks/registry';
import type { BlockRendererCtx } from '../blocks/types';
import { preloadFonts } from '../registries/fonts';
import type { CaptionPage, TikTokCaptionStyle } from '../types/video-config';
import { DEFAULT_TIKTOK_CAPTION_STYLE } from '../types/video-config';
import { MusicLayer } from './music-layer';
import { TikTokCaptions } from './tiktok-captions/tiktok-captions';

// Template renderer — generic block-registry interpreter (§12). Walks the
// resolved region tree (§4) and dispatches each block by `kind` to the
// renderer-side BlockRenderer registry.
//
// CRITICAL: no `if (block.kind === '…')` chain. Every kind is one lookup. If
// the lookup misses, the renderer skips the block (and warns once).

interface TemplateRendererProps extends RenderDoc {}

export const TemplateRenderer: React.FC<TemplateRendererProps> = (doc) => {
  // Preload every font referenced by the resolved type-styles before first
  // paint (§14). @remotion/google-fonts handles delayRender/continueRender
  // internally — multiple calls dedupe. Doing it once at module-eval time
  // (rather than in useEffect) keeps Remotion's still-renderer happy too.
  const typeStyles = collectTypeStyles(doc.root);
  if (doc.globals.captions?.typeStyle) {
    typeStyles.push(doc.globals.captions.typeStyle);
  }
  preloadFonts(typeStyles);

  const ctx: BlockRendererCtx = {
    fps: doc.fps,
    orientation: doc.orientation,
    region: doc.root,
  };

  const narrationUrl = playableNarrationUrl(doc.globals.audio.narration);

  return (
    <AbsoluteFill>
      <Region region={doc.root} ctx={ctx} />
      {doc.globals.audio.music && (
        <MusicLayer
          config={musicTrackToLegacyConfig(doc.globals.audio.music)}
          fps={doc.fps}
        />
      )}
      {/* Voiceover. The b-roll media-track stays muted; for clip-lift narration
          the lifted talking-head audio is played here as a single track. */}
      {narrationUrl && (
        <Audio
          src={narrationUrl}
          volume={doc.globals.audio.narration?.volume ?? 1}
        />
      )}
      {/* Word-by-word TikTok captions synced to the voiceover (v1 parity). */}
      {doc.globals.captions && doc.globals.captions.pages.length > 0 && (
        <TikTokCaptions
          captionPages={resolvedToCaptionPages(doc.globals.captions, doc.fps)}
          style={resolvedToTikTokStyle(doc.globals.captions)}
        />
      )}
    </AbsoluteFill>
  );
};

// ── Region traversal (§4) ───────────────────────────────────────────

interface RegionProps {
  region: ResolvedRegion;
  ctx: BlockRendererCtx;
}

const Region: React.FC<RegionProps> = ({ region, ctx }) => {
  if (region.kind === 'leaf') {
    return <Leaf region={region} ctx={ctx} />;
  }
  return <Split region={region} ctx={ctx} />;
};

const Leaf: React.FC<{
  region: Extract<ResolvedRegion, { kind: 'leaf' }>;
  ctx: BlockRendererCtx;
}> = ({ region, ctx }) => {
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      {region.spine.map((block) => (
        <BlockSlot key={block.id} block={block} ctx={ctx} />
      ))}
      <AbsoluteFill style={{ pointerEvents: 'none' }}>
        {region.overlays.map((block) => (
          <BlockSlot key={block.id} block={block} ctx={ctx} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const Split: React.FC<{
  region: Extract<ResolvedRegion, { kind: 'split' }>;
  ctx: BlockRendererCtx;
}> = ({ region, ctx }) => {
  const totalWeight =
    region.children.reduce((acc, c) => acc + Math.max(0, c.ratio), 0) || 1;
  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        flexDirection: region.axis === 'h' ? 'row' : 'column',
        overflow: 'hidden',
      }}
    >
      {region.children.map((child, idx) => (
        <div
          key={idx}
          style={{
            flex: `${Math.max(0, child.ratio) / totalWeight} 1 0`,
            position: 'relative',
            overflow: 'hidden',
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <Region
            region={child.region}
            ctx={{ ...ctx, region: child.region }}
          />
        </div>
      ))}
    </AbsoluteFill>
  );
};

// ── Block dispatch ──────────────────────────────────────────────────

const BlockSlot: React.FC<{
  block: ResolvedBlock;
  ctx: BlockRendererCtx;
}> = ({ block, ctx }) => {
  const renderer = getBlockRenderer(block.kind);
  if (!renderer) {
    if (typeof console !== 'undefined') {
      console.warn(
        `[template-renderer] No BlockRenderer for kind="${block.kind}" (block id=${block.id})`
      );
    }
    return null;
  }
  const RendererComponent = renderer.Component;
  return (
    <Sequence from={block.startFrame} durationInFrames={block.durationInFrames}>
      <RendererComponent block={block} ctx={ctx} />
    </Sequence>
  );
};

// ── Helpers ─────────────────────────────────────────────────────────

function musicTrackToLegacyConfig(track: ResolvedMusicTrack): {
  trackId: string;
  url: string;
  volume: number;
} {
  return {
    trackId: track.trackId,
    url: track.url,
    volume: track.volume,
  };
}

// Resolve a Lambda-playable narration URL from the resolved narration. Both the
// `tts` and the lifted `clip` variants carry a concrete `url`. Stubbed TTS URLs
// (no provider key) are not real files, so they are not mounted.
function playableNarrationUrl(
  narration: ResolvedNarration | undefined
): string | undefined {
  if (!narration) return undefined;
  const url = 'url' in narration ? narration.url : undefined;
  if (!url) {
    // Clip-lift narration without a baked URL renders silent — warn so a
    // mysteriously-silent video is traceable to the missing url rather than to
    // a renderer bug. (tts/standalone variants must always carry a url.)
    if (narration.source === 'clip' && typeof console !== 'undefined') {
      console.warn(
        `[template-renderer] narration.source='clip' (clipRef=${narration.clipRef}) but no url baked into the RenderDoc — audio will be silent.`
      );
    }
    return undefined;
  }
  if (url.startsWith('tts-stub://')) return undefined;
  return url;
}

// Map the renderer-agnostic ResolvedCaptions onto the existing TikTok caption
// components. Page bounds are frames; words are ms (the components expect
// exactly this mix). Legacy pages without per-word data fall back to a single
// page-spanning word so the highlight loop still has something to show.
function resolvedToCaptionPages(
  captions: ResolvedCaptions,
  fps: number
): CaptionPage[] {
  return captions.pages.map((page, i) => {
    const words =
      page.words && page.words.length > 0
        ? page.words.map((w) => ({
            text: w.text,
            startMs: w.startMs,
            endMs: w.endMs,
          }))
        : [
            {
              text: page.text,
              startMs: Math.round((page.fromFrame / fps) * 1000),
              endMs: Math.round((page.toFrame / fps) * 1000),
            },
          ];
    // Clamp this page to end no later than the next page starts, so two caption
    // pages never render on top of each other (the page packer adds a small
    // tail gap that would otherwise overlap the next page by a frame or two).
    // The outer Math.max guards against pathological data (out-of-order pages,
    // or a next page that starts before this one ends) producing a negative-
    // duration Sequence.
    const next = captions.pages[i + 1];
    const rawEnd = next ? Math.min(page.toFrame, next.fromFrame) : page.toFrame;
    const endFrame = Math.max(page.fromFrame, rawEnd);
    return {
      id: `cap-${i}`,
      words,
      startFrame: page.fromFrame,
      endFrame,
    };
  });
}

function resolvedToTikTokStyle(captions: ResolvedCaptions): TikTokCaptionStyle {
  if (captions.tikTokStyle) return captions.tikTokStyle;
  // Legacy RenderDocs lack tikTokStyle — fall back to v1 defaults, borrowing
  // the resolved caption color where available.
  return {
    ...DEFAULT_TIKTOK_CAPTION_STYLE,
    color: captions.typeStyle?.color ?? DEFAULT_TIKTOK_CAPTION_STYLE.color,
  };
}

// Walks the resolved region tree and pulls every ResolvedTypeStyle out so
// preloadFonts can dedupe and trigger one delayRender per family.
function collectTypeStyles(region: ResolvedRegion): ResolvedTypeStyle[] {
  const out: ResolvedTypeStyle[] = [];

  const visitBlock = (block: ResolvedBlock): void => {
    switch (block.kind) {
      case 'text':
        out.push(block.typeStyle);
        break;
      case 'staggered-list':
        if (block.lead) out.push(block.lead.typeStyle);
        for (const item of block.items) out.push(item.typeStyle);
        if (block.trail) out.push(block.trail.typeStyle);
        break;
      case 'media-overlay':
        if (block.label) out.push(block.label.typeStyle);
        break;
      case 'info-card':
        if (block.headline) out.push(block.headline.typeStyle);
        if (block.items) out.push(block.items.typeStyle);
        if (block.price) out.push(block.price.typeStyle);
        if (block.cta) out.push(block.cta.typeStyle);
        break;
      default:
        break;
    }
  };

  const visit = (r: ResolvedRegion): void => {
    if (r.kind === 'leaf') {
      for (const b of r.spine) visitBlock(b);
      for (const b of r.overlays) visitBlock(b);
      return;
    }
    for (const child of r.children) visit(child.region);
  };
  visit(region);
  return out;
}

export type { TemplateRendererProps, RenderOrientation };
