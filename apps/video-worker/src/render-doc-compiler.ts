import {
  type CaptionConfig,
  type Database,
  type VideoDraftConfig,
  asset,
  assetAnalysis,
  db as defaultDb,
  eq,
  inArray,
  organization,
  sql,
  video,
} from '@borradh-workspace/database';
import type { VideoRenderJobPayload } from '@borradh-workspace/features/jobs';
import {
  getResolvedTheme,
  synthesizeCaptions,
  synthesizeTts,
} from '@borradh-workspace/features/videos';
import { SHARED_MUSIC_TRACKS } from '@borradh-workspace/features/videos/templates';
import type { Logger } from '@borradh-workspace/observability';
import {
  getCdnUrl,
  getOrgAssetsBucket,
  getPresignedDownloadUrl,
  getPublicAssetsBucket,
  getS3Region,
  isCdnEnabled,
  parseCdnUrl,
  parseS3Url,
} from '@borradh-workspace/storage';
import {
  type BRollClip,
  scheduleBRollClips,
  scheduledClipsToScenes,
} from '@borradh-workspace/video-processing/b-roll';
import type { ActionSegment } from '@borradh-workspace/video-processing/vision';
import {
  type BeatInput,
  InvalidClipRefError,
  type RenderDoc,
  type RenderOrientation,
  type ResolvedBlock,
  type ResolvedCaptions,
  type ResolvedCaptionsPage,
  type ResolvedInfoCardBlock,
  type ResolvedMediaClip,
  type ResolvedMediaOverlayBlock,
  type ResolvedMediaTrackBlock,
  type ResolvedNarration,
  type ResolvedRegion,
  type ResolvedRegionLeaf,
  type ResolvedRegionSplit,
  type ResolvedSolidBlock,
  type ResolvedStaggeredListBlock,
  type ResolvedTextBlock,
  type ResolvedTextElement,
  type ResolvedTikTokCaptionStyle,
  type ResolvedTypeStyle,
  type Slot,
  type TemplateInfoCard,
  type TemplateMediaOverlay,
  type TemplateMediaTrack,
  type TemplateOverlayBlock,
  type TemplateRegion,
  type TemplateSolid,
  type TemplateSpineBlock,
  type TemplateStaggeredList,
  type TemplateText,
  type Theme,
  type TypeStyleOverride,
  blockRegistry,
  engineDefaultTheme,
  fontFamilyForToken,
  getTemplateDocById,
  getTypeStyle,
  resolveMasterFrames,
} from '@borradh-workspace/video-templates';

/**
 * The compiler's READ-ONLY VIEW of the video-render payload.
 *
 * It is derived from the ONE payload declaration
 * (`@borradh-workspace/features/jobs`) rather than restated — this used to be a
 * fourth, independently-drifting copy of the shape. It stays `Partial` (over
 * `videoId`/`organizationId`) only so the local render script can drive the
 * compiler with a hand-built job; every field it reads is documented below.
 *
 *   theme               — pre-resolved by the synthesizer. When absent (a legacy
 *                         job), the compiler re-resolves it from the org's
 *                         brand_kit, falling back to the engine defaults.
 *   synthesisOverrides  — frozen-content envelope: `frozenOfferContent`
 *                         overrides info-card slot fills, `pinnedAssets`
 *                         override seeded media picks.
 */
export type VideoRenderJobV2 = Partial<VideoRenderJobPayload> &
  Pick<VideoRenderJobPayload, 'videoId' | 'organizationId'>;

const FPS = 30;

// Canvas dimensions by orientation. The worker only renders one aspect at a
// time today; the `aspectRatios` array on the TemplateDoc picks the active
// composition on the renderer side.
const DIMENSIONS_BY_ORIENTATION: Record<
  RenderOrientation,
  { width: number; height: number }
> = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
  square: { width: 1080, height: 1080 },
};

// The compiled script the slot resolvers read. `questionText`/`items`/`ctaText`
// are the conventional single-list roles; `lists` carries any additional lists
// for multi-list templates (role 'list', by index). `disclaimer` is a single
// line when present.
interface CompiledScript {
  questionText: string;
  items: string[];
  ctaText: string;
  disclaimer?: string;
  lists: string[][];
}

function splitScriptFrames(scriptText: string | undefined): CompiledScript {
  const lines = (scriptText ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fallback = lines.length > 0 ? lines : ['What you need to know'];
  return {
    questionText: fallback[0] ?? 'What you need to know',
    items: fallback.slice(1, -1).length > 0 ? fallback.slice(1, -1) : fallback,
    ctaText:
      fallback.length > 1
        ? (fallback.at(-1) ?? 'DM to learn more')
        : 'DM to learn more',
    lists: [],
  };
}

// Builds the CompiledScript from the structured roles persisted at synthesis
// time (preferred — carries hook/body/cta/disclaimer and multi-list `lists`).
// Falls back to splitting the flattened scriptText for legacy/v1 drafts.
function buildCompiledScript(draftConfig: VideoDraftConfig): CompiledScript {
  const roles = draftConfig.scriptRoles;
  if (roles) {
    return {
      questionText: roles.hook,
      items: roles.body ?? [],
      ctaText: roles.cta ?? '',
      disclaimer: roles.disclaimer,
      lists: roles.lists ?? [],
    };
  }
  return splitScriptFrames(draftConfig.scriptText);
}

// Collect every spine + overlay block from a region tree, in traversal order.
// Flattened across leaves — used only for master-duration resolution, where a
// `driven by <id>` reference just needs to find its driver anywhere in the doc.
function collectLeafBlocks(region: TemplateRegion): {
  spine: BeatInput[];
  overlays: BeatInput[];
} {
  const groups = collectLeafGroups(region);
  return {
    spine: groups.flatMap((g) => g.spine),
    overlays: groups.flatMap((g) => g.overlays),
  };
}

// One entry per leaf region. Beat durations must be resolved per-leaf because
// each leaf's spine and overlays are PARALLEL tracks that independently span
// the master. Flattening across leaves (or across spine+overlay) makes the
// sequential duration resolver split the master between blocks that should
// each fill it — e.g. two `fill` spines in different split panes, or a `fill`
// b-roll sharing a region with a `content` overlay that already spans master.
function collectLeafGroups(
  region: TemplateRegion
): { spine: BeatInput[]; overlays: BeatInput[] }[] {
  if (region.kind === 'leaf') {
    return [
      {
        spine: region.spine.map((b) => ({
          id: b.id,
          kind: b.kind,
          duration: b.duration,
          params: b,
        })),
        overlays: region.overlays.map((b) => ({
          id: b.id,
          kind: b.kind,
          duration: b.duration,
          params: b,
        })),
      },
    ];
  }
  return region.children.flatMap((child) => collectLeafGroups(child.region));
}

// Find an overlay/spine block in the template tree by id. Used to resolve
// `master.driven by ElementId` and `narration.clipRef`.
function findBlockById(
  region: TemplateRegion,
  id: string
): { kind: string } | undefined {
  if (region.kind === 'leaf') {
    return (
      region.spine.find((b) => b.id === id) ??
      region.overlays.find((b) => b.id === id)
    );
  }
  for (const child of region.children) {
    const hit = findBlockById(child.region, id);
    if (hit) return hit;
  }
  return undefined;
}

// The TTS service stores its audio in the org-assets bucket at
// `{org}/synthesized-audio/tts/{hash}.wav`, but returns a URL built via the
// public-CDN helper (which prepends `public/`). Recover the true org-assets
// key from whatever URL/key shape we were given so we can both presign it for
// the renderer and download it (by key) for Whisper.
function orgAssetsKeyFromTtsUrl(url: string): string | undefined {
  let path = url;
  const schemeIdx = path.indexOf('://');
  if (schemeIdx >= 0) {
    const afterScheme = path.slice(schemeIdx + 3);
    const firstSlash = afterScheme.indexOf('/');
    path = firstSlash >= 0 ? afterScheme.slice(firstSlash + 1) : '';
  }
  path = path.replace(/^\/+/, '');
  const q = path.indexOf('?');
  if (q >= 0) path = path.slice(0, q);
  path = path.replace(/^public\//, '');
  return path || undefined;
}

async function presignS3UrlIfNeeded(url: string): Promise<string> {
  const s3Info = parseS3Url(url);
  if (s3Info) {
    return getPresignedDownloadUrl({
      bucket: s3Info.bucket,
      key: s3Info.key,
      expiresIn: 3600,
    });
  }

  if (isCdnEnabled()) {
    // Resolve scope from the CDN path: `/public/...` is served from the PUBLIC
    // bucket with the prefix stripped. Defaulting everything to the org bucket
    // sent every stock-footage render to a key that does not exist.
    const loc = parseCdnUrl(url);
    if (loc) {
      return getPresignedDownloadUrl({
        bucket:
          loc.scope === 'public'
            ? getPublicAssetsBucket()
            : getOrgAssetsBucket(),
        key: loc.key,
        expiresIn: 3600,
      });
    }
  }

  if (url.includes('?')) return url;

  return url;
}

function resolveRegistryMusicUrl(pathOrUrl: string): string {
  if (/^https?:\/\//.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const cdnUrl = getCdnUrl()?.replace(/\/$/, '');
  if (cdnUrl) {
    const cleanPath = pathOrUrl.startsWith('/') ? pathOrUrl : `/${pathOrUrl}`;
    return `${cdnUrl}${cleanPath}`;
  }

  const key = pathOrUrl.replace(/^\/+/, '').replace(/^public\//, '');
  return `https://${getPublicAssetsBucket()}.s3.${getS3Region()}.amazonaws.com/public/${key}`;
}

function normalizeRenderDocMusicUrl(renderDoc: RenderDoc): RenderDoc {
  const music = renderDoc.globals.audio.music;
  if (!music) return renderDoc;

  const resolvedUrl = resolveRegistryMusicUrl(music.url);
  if (resolvedUrl === music.url) return renderDoc;

  return {
    ...renderDoc,
    globals: {
      ...renderDoc.globals,
      audio: {
        ...renderDoc.globals.audio,
        music: {
          ...music,
          url: resolvedUrl,
        },
      },
    },
  };
}

// Re-presign the narration audio URL on retry. TTS / custom-voiceover URLs are
// presigned S3 / CDN links that expire; without this a `skipCompile` replay
// plays silent/expired audio. Stub URLs are left untouched (not real files).
async function refreshNarrationUrl(renderDoc: RenderDoc): Promise<RenderDoc> {
  const narration = renderDoc.globals.audio.narration;
  if (!narration || !('url' in narration) || !narration.url) return renderDoc;
  if (narration.url.startsWith('tts-stub://')) return renderDoc;

  const refreshed = await presignS3UrlIfNeeded(narration.url);
  if (refreshed === narration.url) return renderDoc;

  return {
    ...renderDoc,
    globals: {
      ...renderDoc.globals,
      audio: {
        ...renderDoc.globals.audio,
        narration: { ...narration, url: refreshed },
      },
    },
  };
}

// Build a concrete TikTok caption style from the video's draft caption config
// plus stroke defaults (the draft has no stroke fields). White + black stroke
// keeps captions legible over any b-roll, regardless of the theme's text color.
function tikTokStyleFromDraft(
  c: CaptionConfig | undefined
): ResolvedTikTokCaptionStyle {
  return {
    position: c?.position ?? 'bottom',
    // The draft may store a token like "inter"; the renderer needs a real CSS
    // family, and the TikTok look is Inter regardless.
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: c?.fontSize ?? 64,
    color: c?.textColor ?? '#FFFFFF',
    highlightColor: c?.highlightColor ?? '#FFFFFF',
    backgroundColor: c?.backgroundColor ?? 'transparent',
    showBackground: c?.showBackground ?? false,
    strokeWidth: 20,
    strokeColor: '#000000',
  };
}

async function refreshClipUrl(
  clip: ResolvedMediaClip
): Promise<ResolvedMediaClip> {
  const url = await presignS3UrlIfNeeded(clip.url);
  return url === clip.url ? clip : { ...clip, url };
}

async function refreshBlockUrls(block: ResolvedBlock): Promise<ResolvedBlock> {
  if (block.kind === 'media-track') {
    return {
      ...block,
      clips: await Promise.all(block.clips.map(refreshClipUrl)),
    };
  }

  if (block.kind === 'media-overlay') {
    return {
      ...block,
      clip: await refreshClipUrl(block.clip),
    };
  }

  return block;
}

async function refreshRegionUrls(
  region: ResolvedRegion
): Promise<ResolvedRegion> {
  if (region.kind === 'leaf') {
    return {
      ...region,
      spine: await Promise.all(region.spine.map(refreshBlockUrls)),
      overlays: await Promise.all(region.overlays.map(refreshBlockUrls)),
    };
  }

  return {
    ...region,
    children: await Promise.all(
      region.children.map(async (child) => ({
        ...child,
        region: await refreshRegionUrls(child.region),
      }))
    ),
  };
}

async function refreshRenderDocUrls(renderDoc: RenderDoc): Promise<RenderDoc> {
  const withMusic = normalizeRenderDocMusicUrl(renderDoc);
  const withNarration = await refreshNarrationUrl(withMusic);
  return {
    ...withNarration,
    root: await refreshRegionUrls(withNarration.root),
  };
}

async function resolveBRollAssets(
  db: Database,
  assetIds: string[]
): Promise<
  Map<
    string,
    {
      url: string;
      durationSec: number;
      mediaType: 'video' | 'image';
      actionSegments?: ActionSegment[];
    }
  >
> {
  if (assetIds.length === 0) return new Map();

  const assets = await db.query.asset.findMany({
    where: inArray(asset.id, assetIds),
    columns: {
      id: true,
      blobUrl: true,
      transcodedBlobUrl: true,
      duration: true,
      type: true,
    },
  });

  const analyses = await db.query.assetAnalysis.findMany({
    where: inArray(assetAnalysis.assetId, assetIds),
    columns: {
      assetId: true,
      status: true,
      analysisResult: true,
    },
  });

  const analysisMap = new Map<
    string,
    { segments?: ActionSegment[]; durationSec?: number }
  >();
  for (const analysis of analyses) {
    if (analysis.status !== 'completed' || !analysis.analysisResult) continue;
    const result = analysis.analysisResult;
    const segments = result.actionSegments as ActionSegment[] | undefined;
    let durationSec = (result as { videoDurationSec?: number })
      .videoDurationSec;
    if (!durationSec && segments && segments.length > 0) {
      durationSec = Math.max(...segments.map((segment) => segment.endSec));
    }
    analysisMap.set(analysis.assetId, { segments, durationSec });
  }

  const resolved = new Map<
    string,
    {
      url: string;
      durationSec: number;
      mediaType: 'video' | 'image';
      actionSegments?: ActionSegment[];
    }
  >();

  for (const record of assets) {
    const isImage = record.type === 'image';
    const analysisData = analysisMap.get(record.id);
    resolved.set(record.id, {
      url: await presignS3UrlIfNeeded(
        record.transcodedBlobUrl ?? record.blobUrl
      ),
      durationSec: isImage
        ? 5
        : record.duration || analysisData?.durationSec || 10,
      mediaType: record.type as 'video' | 'image',
      actionSegments: analysisData?.segments,
    });
  }

  return resolved;
}

// Resolves the spine's b-roll clips into a list of ResolvedMediaClip values
// covering the whole `totalFrames` window.
async function resolveSpineClips(
  db: Database,
  draftConfig: VideoDraftConfig,
  totalDurationSec: number,
  bpm: number,
  beatsPerEdit = 4
): Promise<ResolvedMediaClip[]> {
  const clipIds = draftConfig.bRollClips.map((clip) => clip.assetId);
  const resolvedAssets = await resolveBRollAssets(db, clipIds);

  const masterFrames = Math.round(totalDurationSec * FPS);

  const bRollClips: BRollClip[] = draftConfig.bRollClips
    // Return type annotated. Inferred, the literal's `clipType` is the draft's
    // narrower `ClipType` (no 'procedure'), so `clip is BRollClip` is not a
    // legal narrowing of it — the predicate was rejected and the nulls stayed
    // in the element type.
    .map((clip, index): BRollClip | null => {
      const assetData = resolvedAssets.get(clip.assetId);
      if (!assetData) return null;
      return {
        id: clip.assetId,
        url: assetData.url,
        sourceDurationSec: assetData.durationSec,
        order: clip.order ?? index,
        clipType: clip.clipType,
        mediaType: assetData.mediaType,
        actionSegments: assetData.actionSegments,
      };
    })
    .filter((clip): clip is BRollClip => clip !== null);

  // Single distinct clip: beat-cutting one piece of footage just restarts it
  // every few beats → a visible stutter (this also catches drafts that list the
  // same asset multiple times). Instead play it continuously and loop to fill,
  // with a crossfade ('fade') smoothing each loop boundary.
  const distinctUrls = new Set(bRollClips.map((c) => c.url));
  if (bRollClips.length >= 1 && distinctUrls.size === 1) {
    const only = bRollClips[0];
    const clipFrames = Math.max(1, Math.round(only.sourceDurationSec * FPS));
    const out: ResolvedMediaClip[] = [];
    let cur = 0;
    let rep = 0;
    while (cur < masterFrames && rep < 2000) {
      const dur = Math.min(clipFrames, masterFrames - cur);
      out.push({
        id: `${only.id}#${rep}`,
        url: only.url,
        // BRollClip.mediaType is optional and documents video as the default;
        // ResolvedMediaClip requires it. Same fallback as the scene path below.
        mediaType: only.mediaType ?? 'video',
        trimStartFrames: 0,
        startFrame: cur,
        durationInFrames: dur,
        transition: 'fade',
      });
      cur += dur;
      rep++;
    }
    return out;
  }

  const scheduled = scheduleBRollClips(bRollClips, {
    totalDurationSec,
    introSec: 0,
    outroBufferSec: 0,
    minClipDurationSec: 2,
    maxClipDurationSec: 5,
    gapBetweenClipsSec: 0,
    fps: FPS,
    bpm,
    beatsPerEdit,
    targetCoverage: 1,
    // Recycle clips so the b-roll fills the whole video even when the voiceover
    // is longer than the available footage (e.g. one short procedure clip under
    // a 30s narration) — otherwise the track runs out and the screen goes black.
    recycleClips: true,
  });

  const clipLookup = new Map(bRollClips.map((clip) => [clip.id, clip]));
  const scenes = scheduledClipsToScenes(scheduled, FPS, clipLookup);

  const clips: ResolvedMediaClip[] = scenes.map((scene, idx) => ({
    id: scene.id ?? `clip-${idx}`,
    url: scene.clipUrl,
    mediaType: (scene.mediaType ?? 'video') as 'video' | 'image',
    trimStartFrames: scene.trimStart,
    startFrame: scene.startFrame,
    durationInFrames: scene.durationInFrames,
    // Crossfade between cuts so hard jumps are softened.
    transition: 'fade',
  }));

  // The beat scheduler stops on whole beat-edits, which can leave a short tail
  // uncovered before the master end → a black gap. Fill it by APPENDING recycled
  // clip segments (each from the clip's start, capped to its source length)
  // rather than stretching the last clip — stretching a clip past its source
  // duration makes Remotion render black frames at the end (the reported bug).
  let coveredEnd = clips.length
    ? (clips.at(-1)?.startFrame ?? 0) + (clips.at(-1)?.durationInFrames ?? 0)
    : 0;
  // Continue from whatever was on screen last rather than restarting at clip 0.
  // Restarting put the OPENING shot at the end of the video — the bookend a
  // botox render shipped — which reads as a loop rather than as a tail.
  const lastShownId = clips.at(-1)?.id?.split('#')[0];
  const lastShownIdx = bRollClips.findIndex((c) => c.id === lastShownId);
  const tailStart = lastShownIdx >= 0 ? lastShownIdx : 0;
  let cycle = 0;
  while (coveredEnd < masterFrames && bRollClips.length > 0 && cycle < 2000) {
    const src = bRollClips[(tailStart + cycle) % bRollClips.length];
    if (!src) break;
    const srcFrames = Math.max(1, Math.round(src.sourceDurationSec * FPS));
    const dur = Math.min(srcFrames, masterFrames - coveredEnd);
    clips.push({
      id: `${src.id}#tail${cycle}`,
      url: src.url,
      mediaType: src.mediaType ?? 'video',
      trimStartFrames: 0,
      startFrame: coveredEnd,
      durationInFrames: dur,
      transition: 'fade',
    });
    coveredEnd += dur;
    cycle++;
  }

  return clips;
}

// Builds one b-roll clip per statement window of a sequential overlay so the
// scene changes on every statement change (v1 fade-benefits / improves: 1 clip
// ↔ 1 line). Clips cycle through the uploaded footage when there are fewer
// clips than statements (v1 `bRollClips[i % n]`). The final clip is stretched
// to the master end so no black tail shows. Falls back to an empty array (the
// caller then uses normal beat-synced scheduling) when there's no footage.
async function resolveOverlaySyncedClips(
  db: Database,
  draftConfig: VideoDraftConfig,
  segmentCount: number,
  segmentFrames: number,
  overlayStartFrame: number,
  masterFrames: number
): Promise<ResolvedMediaClip[]> {
  const clipIds = draftConfig.bRollClips.map((c) => c.assetId).filter(Boolean);
  const resolvedAssets = await resolveBRollAssets(db, clipIds);
  const ordered = draftConfig.bRollClips
    .map((clip) => {
      const data = resolvedAssets.get(clip.assetId);
      return data ? { id: clip.assetId, ...data } : null;
    })
    .filter((a): a is NonNullable<typeof a> => !!a);
  if (ordered.length === 0 || segmentCount <= 0 || segmentFrames <= 0) {
    return [];
  }

  const clips: ResolvedMediaClip[] = [];
  for (let k = 0; k < segmentCount; k++) {
    // Monotonic, not `k % ordered.length`. Wrapping re-introduced clip 0 as the
    // closing statement whenever there were fewer clips than statements, which
    // is the majority case. Spreading holds each clip across consecutive
    // statements instead, so the video always progresses.
    const assetData =
      ordered[
        Math.min(
          Math.floor((k * ordered.length) / segmentCount),
          ordered.length - 1
        )
      ];
    if (!assetData) continue;
    const start = overlayStartFrame + k * segmentFrames;
    if (start >= masterFrames) break;
    const isLast = k === segmentCount - 1;
    const window = isLast
      ? Math.max(1, masterFrames - start)
      : Math.min(segmentFrames, masterFrames - start);
    // Never let a clip run past its source (Remotion renders black past the
    // end). A clip shorter than its statement window holds its last frame.
    const srcFrames = Math.max(1, Math.round(assetData.durationSec * FPS));
    const dur = Math.min(window, srcFrames);
    clips.push({
      id: `${assetData.id}#${k}`,
      url: assetData.url,
      mediaType: assetData.mediaType,
      trimStartFrames: 0,
      startFrame: start,
      durationInFrames: dur,
      transition: 'fade',
    });
  }
  return clips;
}

// Resolves the spine clips for a `clip-length` media-track (authority-1
// talking-head path). Clips play in their natural duration without beat-synced
// scheduling. Clips come from draftConfig.bRollClips in order.
async function resolveClipLengthSpine(
  db: Database,
  draftConfig: VideoDraftConfig,
  totalFrames: number
): Promise<ResolvedMediaClip[]> {
  const clipIds = draftConfig.bRollClips.map((c) => c.assetId).filter(Boolean);
  if (clipIds.length === 0) return [];
  const resolvedAssets = await resolveBRollAssets(db, clipIds);
  const usable = draftConfig.bRollClips.filter((c) =>
    resolvedAssets.has(c.assetId)
  );
  if (usable.length === 0) return [];

  // Recycle clips so the spine fills the whole video. A talking-head clip is
  // often shorter than a voiceover-driven master (e.g. a 17s clip under a 30s
  // narration) — without looping, the spine runs out and the screen goes black.
  //
  // The `%` here is DELIBERATE and unlike the ones removed elsewhere. Those
  // mapped a fixed set of copy-driven scenes onto footage, where wrapping put
  // the opening shot at the end. This is a continuous spine under narration
  // with no scene semantics at all: the alternative to looping is a black
  // screen. Leave it.
  const clips: ResolvedMediaClip[] = [];
  let currentFrame = 0;
  let i = 0;
  while (currentFrame < totalFrames && i < 2000) {
    const clipConfig = usable[i % usable.length];
    const assetData = resolvedAssets.get(clipConfig.assetId);
    if (!assetData) break;
    const clipFrames = Math.min(
      Math.round(assetData.durationSec * FPS),
      totalFrames - currentFrame
    );
    if (clipFrames <= 0) break;
    clips.push({
      // Unique per repetition so the renderer's keys don't collide on loop.
      id: `${clipConfig.assetId}#${i}`,
      url: assetData.url,
      mediaType: assetData.mediaType,
      trimStartFrames: 0,
      startFrame: currentFrame,
      durationInFrames: clipFrames,
      // Crossfade the loop boundary so the talking-head restart isn't a hard cut.
      transition: 'fade',
    });
    currentFrame += clipFrames;
    i++;
  }
  return clips;
}

// Resolves a TypeStyleToken to a concrete ResolvedTypeStyle, then merges any
// per-element override on top (single source of truth for text styling).
// `colorRole` binds to a theme colour; a literal `color` wins.
function resolveStyle(
  token: Parameters<typeof getTypeStyle>[0],
  theme: Theme,
  override?: TypeStyleOverride
): ResolvedTypeStyle {
  const base = getTypeStyle(token, theme);
  if (!override) return base;
  // `colorRole` and `fontRef` are authoring conveniences, not resolved fields —
  // strip them out and fold their effect into color / fontFamily.
  const { colorRole, fontRef, ...rest } = override;
  const merged: ResolvedTypeStyle = { ...base, ...rest };
  if (colorRole && rest.color === undefined) {
    merged.color = theme.colors[colorRole];
  }
  if (fontRef) {
    merged.fontFamily = fontFamilyForToken(fontRef);
  }
  return merged;
}

// Per-segment frame layout for a staggered list. A "segment" is one displayed
// element in order: lead (if any) → each item → trail (if any).
//
//  - `accumulate`: items stack; each enters one `beatsPerItem` apart (beat-based).
//  - `sequential`: one element on screen at a time, so the block duration is
//    split EVENLY across all segments. This avoids the v1-divergence where a
//    leadless list left a blank opening window and overshot the master (text
//    spilling past the footage); it also yields an integer window per statement
//    that a media-track can cut to (1 clip ↔ 1 statement).
interface StaggeredSegmentLayout {
  framesPerItem: number;
  segmentCount: number;
  /** 1 when a lead occupies window 0, else 0 — items index from here. */
  leadOffset: number;
}

function staggeredSegmentLayout(
  block: TemplateStaggeredList,
  itemCount: number,
  bpm: number,
  durationInFrames: number
): StaggeredSegmentLayout {
  const leadOffset = block.lead ? 1 : 0;
  const trailCount = block.trail ? 1 : 0;
  const segmentCount = leadOffset + itemCount + trailCount;
  if (block.reveal === 'sequential' && segmentCount > 0) {
    return {
      framesPerItem: Math.floor(durationInFrames / segmentCount),
      segmentCount,
      leadOffset,
    };
  }
  const framesPerBeat = Math.round((60 / bpm) * FPS);
  return {
    framesPerItem: framesPerBeat * block.stagger.beatsPerItem,
    segmentCount,
    leadOffset,
  };
}

// Compiles a TemplateStaggeredList block using the block's own stagger/style
// config rather than hardcoded values. This replaces the educational-1-specific
// `buildStaggeredList` for the generic dispatch path.
function compileStaggeredListFromTemplate(
  block: TemplateStaggeredList,
  script: CompiledScript,
  brand: BrandContext,
  bpm: number,
  startFrame: number,
  durationInFrames: number,
  theme: Theme
): ResolvedStaggeredListBlock {
  // Resolve the block's OWN declared slots — fixed labels (e.g. "INS"/"OUTS")
  // and per-role/per-list content — instead of assuming hook/body/cta. This is
  // what lets a template compose multiple labeled lists generically.
  const items = resolveStringArraySlot(block.items.texts, script);
  const { framesPerItem, leadOffset } = staggeredSegmentLayout(
    block,
    items.length,
    bpm,
    durationInFrames
  );

  const lead: ResolvedTextElement | undefined = block.lead
    ? {
        id: 'lead',
        text: resolveStringSlot(block.lead.text, script, brand),
        typeStyle: resolveStyle(
          block.lead.style,
          theme,
          block.lead.styleOverride
        ),
        container: block.lead.container ?? 'none',
        entrance: block.lead.entrance,
        entranceFrame: 0,
      }
    : undefined;

  const trail: ResolvedTextElement | undefined = block.trail
    ? {
        id: 'trail',
        text: resolveStringSlot(block.trail.text, script, brand),
        typeStyle: resolveStyle(
          block.trail.style,
          theme,
          block.trail.styleOverride
        ),
        container: block.trail.container ?? 'none',
        entrance: block.trail.entrance,
        entranceFrame: framesPerItem * (items.length + leadOffset),
      }
    : undefined;

  // Optional per-item kicker (e.g. "IMPROVES:") — same label above every item.
  const kickerCfg = block.items.kicker;
  const kicker = kickerCfg
    ? {
        text: resolveStringSlot(kickerCfg.text, script, brand),
        typeStyle: resolveStyle(
          kickerCfg.style,
          theme,
          kickerCfg.styleOverride
        ),
      }
    : undefined;

  const itemElements: ResolvedTextElement[] = items.map((text, i) => ({
    id: `item-${i}`,
    // For numbered lists the renderer draws the index badge, so strip any
    // leading enumeration the model added ("1. ", "2)", "3 - ") to avoid the
    // number showing twice.
    text: block.numbered ? text.replace(/^\s*\d+\s*[.)\-–:]\s+/, '') : text,
    typeStyle: resolveStyle(
      block.items.style,
      theme,
      block.items.styleOverride
    ),
    container: block.items.container ?? 'none',
    entrance: block.items.entrance,
    entranceFrame: framesPerItem * (i + leadOffset),
    kicker,
  }));

  return {
    kind: 'staggered-list',
    id: block.id,
    startFrame,
    durationInFrames,
    lead,
    items: itemElements,
    trail,
    // 0 = no stagger (all elements at frame 0); keep the stored value ≥1 to
    // satisfy the resolved schema — entranceFrame already used the real value.
    beatsPerItemFrames: Math.max(1, framesPerItem),
    reveal: block.reveal,
    numbered: block.numbered,
    hAlign: block.hAlign,
    placement: block.placement,
  };
}

// Resolves a media-overlay block at compile time by querying the DB for an
// asset matching the block's clip slot query. Returns null when no asset is
// found (required=false slots) or the clip source is not a DB query.
// startFrame is computed by the caller (sequential overlay accumulator).
async function compileMediaOverlayFromTemplate(
  block: TemplateMediaOverlay,
  db: Database,
  organizationId: string,
  startFrame: number,
  durationInFrames: number
): Promise<ResolvedMediaOverlayBlock | null> {
  if (block.clip.source !== 'query' || block.clip.query.kind !== 'asset-media')
    return null;
  const query = block.clip.query;

  const rows = await db
    .select({ id: asset.id })
    .from(asset)
    .where(
      sql`${asset.organizationId} = ${organizationId} AND ${asset.type} = ${query.mediaType} AND ${asset.tags} @> ARRAY[${query.tag}]::text[]`
    )
    .limit(1);

  if (rows.length === 0) {
    if (block.clip.required) {
      throw new Error(
        `Required media-overlay "${block.id}" has no assets tagged "${query.tag}"`
      );
    }
    return null;
  }

  const assetRow = await db.query.asset.findFirst({
    where: eq(asset.id, rows[0].id),
    columns: {
      id: true,
      blobUrl: true,
      transcodedBlobUrl: true,
      duration: true,
      type: true,
    },
  });
  if (!assetRow) return null;

  const url = await presignS3UrlIfNeeded(
    assetRow.transcodedBlobUrl ?? assetRow.blobUrl
  );

  return {
    kind: 'media-overlay',
    id: block.id,
    startFrame,
    durationInFrames,
    clip: {
      id: assetRow.id,
      url,
      mediaType: assetRow.type as 'video' | 'image',
      trimStartFrames: 0,
      startFrame: 0,
      durationInFrames,
    },
    placement: block.placement,
    fit: block.fit,
    kenBurns: block.kenBurns,
  };
}

// ── Slot resolvers ──────────────────────────────────────────────────
// Resolve Slot<string> and Slot<string[]> to concrete values at compile time.
// Brand slots use org name/logo fetched once at the top of compileRenderDoc.
// Script-text slots map to the pre-parsed script parts.

interface BrandContext {
  orgName: string;
  orgLogo?: string;
  orgTagline?: string;
}

function resolveStringSlot(
  slot: Slot<string>,
  script: CompiledScript,
  brand: BrandContext,
  fallback = ''
): string {
  if (slot.source === 'fixed') return slot.value;
  const q = slot.query;
  if (q.kind === 'brand') {
    if (q.field === 'businessName') return brand.orgName || fallback;
    if (q.field === 'logoUrl') return brand.orgLogo ?? fallback;
    if (q.field === 'tagline') return brand.orgTagline ?? fallback;
  }
  if (q.kind === 'script-text') {
    if (q.role === 'hook') return script.questionText || fallback;
    if (q.role === 'body') return script.items[q.index ?? 0] ?? fallback;
    if (q.role === 'cta') return script.ctaText || fallback;
    if (q.role === 'disclaimer') return script.disclaimer || fallback;
    if (q.role === 'list') return script.lists[q.index ?? 0]?.[0] ?? fallback;
  }
  return fallback;
}

function resolveStringArraySlot(
  slot: Slot<string[]>,
  script: CompiledScript
): string[] {
  if (slot.source === 'fixed') return slot.value;
  const q = slot.query;
  if (q.kind === 'script-text') {
    if (q.role === 'body') return script.items;
    if (q.role === 'hook') return [script.questionText];
    if (q.role === 'cta') return [script.ctaText];
    if (q.role === 'disclaimer')
      return script.disclaimer ? [script.disclaimer] : [];
    if (q.role === 'list') return script.lists[q.index ?? 0] ?? [];
  }
  return [];
}

function compileTextOverlay(
  block: TemplateText,
  startFrame: number,
  durationInFrames: number,
  script: CompiledScript,
  brand: BrandContext,
  theme: Theme
): ResolvedTextBlock {
  return compileTextBlock({
    block,
    startFrame,
    durationInFrames,
    text: resolveStringSlot(block.text, script, brand),
    theme,
  });
}

function compileInfoCardOverlay(
  block: TemplateInfoCard,
  startFrame: number,
  durationInFrames: number,
  script: CompiledScript,
  brand: BrandContext,
  theme: Theme
): ResolvedInfoCardBlock {
  const headlineText = block.headline
    ? resolveStringSlot(block.headline.text, script, brand) || undefined
    : undefined;
  const rawItems = block.items
    ? resolveStringArraySlot(block.items.texts, script)
    : undefined;
  const itemsTexts = rawItems?.length ? rawItems : undefined;
  let priceValue: string | undefined;
  let priceCurrency: string | undefined;
  if (block.price) {
    priceValue = resolveStringSlot(block.price.value, script, brand, '');
    priceCurrency = resolveStringSlot(
      block.price.currency,
      script,
      brand,
      'USD'
    );
  }
  const ctaText = block.cta
    ? resolveStringSlot(block.cta.text, script, brand, '') || undefined
    : undefined;
  const logoUrl = block.logo
    ? resolveStringSlot(block.logo.url, script, brand) || undefined
    : undefined;
  return compileInfoCardBlock({
    block,
    startFrame,
    durationInFrames,
    headlineText,
    itemsTexts,
    priceValue,
    priceCurrency,
    ctaText,
    logoUrl,
    theme,
  });
}

// ── Region compiler ─────────────────────────────────────────────────
// Context shared by every leaf region in a compile pass. Split regions
// recurse with the same context since they share master duration/bpm/theme.

interface CompileRegionContext {
  db: Database;
  draftConfig: VideoDraftConfig;
  totalFrames: number;
  totalDurationSec: number;
  bpm: number;
  script: CompiledScript;
  theme: Theme;
  organizationId: string;
  brand: BrandContext;
  blockResolvedFrames: Map<string, number>;
  /**
   * Fraction (0–1] of the full composition WIDTH this leaf occupies, i.e. the
   * product of the horizontal-split ratios on the path to it. Engine type sizes
   * are authored against the full canvas width, so a leaf inside a narrow split
   * pane (e.g. offer-square-1's 2/5 info-card pane) bakes its font sizes scaled
   * by this so the text fits the pane instead of overflowing. 1 = full width.
   */
  widthScale: number;
}

async function compileLeafRegion(
  leaf: Extract<TemplateRegion, { kind: 'leaf' }>,
  ctx: CompileRegionContext
): Promise<ResolvedRegionLeaf> {
  const {
    db,
    draftConfig,
    totalFrames,
    totalDurationSec,
    bpm,
    script,
    theme,
    organizationId,
    brand,
    blockResolvedFrames,
  } = ctx;

  // Pre-compute a sequential staggered-list's statement windows so a media-track
  // with cuts: 'overlay-synced' can cut one clip per statement (v1 1 clip ↔
  // 1 line). These templates place the sequential list as the sole content
  // overlay starting at frame 0.
  const sequentialList = (leaf.overlays as TemplateOverlayBlock[]).find(
    (o): o is TemplateStaggeredList =>
      o.kind === 'staggered-list' && o.reveal === 'sequential'
  );
  const sequentialLayout = sequentialList
    ? staggeredSegmentLayout(
        sequentialList,
        script.items.length,
        bpm,
        blockResolvedFrames.get(sequentialList.id) ?? totalFrames
      )
    : null;

  // ── Spine ──
  const resolvedSpineBlocks: ResolvedBlock[] = [];
  for (const spineBlock of leaf.spine as TemplateSpineBlock[]) {
    if (spineBlock.kind === 'media-track') {
      const block = spineBlock as TemplateMediaTrack;
      const resolvedBlockFrames =
        blockResolvedFrames.get(block.id) ?? totalFrames;
      const cutsMode = block.cuts?.mode ?? 'beat-synced';
      let clips: ResolvedMediaClip[];
      if (cutsMode === 'overlay-synced' && sequentialLayout) {
        clips = await resolveOverlaySyncedClips(
          db,
          draftConfig,
          sequentialLayout.segmentCount,
          sequentialLayout.framesPerItem,
          0,
          resolvedBlockFrames
        );
        // No footage resolved → fall back to beat-synced so the screen isn't black.
        if (clips.length === 0) {
          clips = await resolveSpineClips(
            db,
            draftConfig,
            totalDurationSec,
            bpm,
            4
          );
        }
      } else if (cutsMode === 'clip-length') {
        clips = await resolveClipLengthSpine(
          db,
          draftConfig,
          resolvedBlockFrames
        );
      } else {
        const beatsPerEdit =
          cutsMode === 'beat-synced'
            ? (block.cuts as { mode: 'beat-synced'; beatsPerEdit: number })
                .beatsPerEdit
            : 4;
        clips = await resolveSpineClips(
          db,
          draftConfig,
          totalDurationSec,
          bpm,
          beatsPerEdit
        );
      }
      resolvedSpineBlocks.push({
        kind: 'media-track',
        id: block.id,
        startFrame: 0,
        durationInFrames: resolvedBlockFrames,
        clips,
        fit: block.fit ?? 'cover',
      } satisfies ResolvedMediaTrackBlock);
    } else if (spineBlock.kind === 'solid') {
      const block = spineBlock as TemplateSolid;
      const resolvedBlockFrames =
        blockResolvedFrames.get(block.id) ?? totalFrames;
      const color = resolveStringSlot(block.color, script, brand, '#FFFFFF');
      resolvedSpineBlocks.push(
        compileSolidBlock({
          block,
          startFrame: 0,
          durationInFrames: resolvedBlockFrames,
          color,
        })
      );
    }
  }

  // ── Overlays (sequential: each starts where the previous ended) ──
  // The cumulative start is clamped so no overlay extends past the master end.
  // Authority-style cutaways (all media-overlay) cluster at the beginning;
  // before-after / info-card outro sequences play in their natural order.
  const resolvedOverlayBlocks: ResolvedBlock[] = [];
  let cumulativeOverlayStart = 0;
  for (const overlayBlock of leaf.overlays as TemplateOverlayBlock[]) {
    const resolvedBlockFrames =
      blockResolvedFrames.get(overlayBlock.id) ?? totalFrames;
    const endAnchorStart = Math.max(0, totalFrames - resolvedBlockFrames);
    // `from-end` overlays (e.g. an outro end-card) pin to the master end and
    // don't participate in the sequential accumulator — so they land last even
    // when the preceding content (cutaways) doesn't tile the full master. Every
    // other overlay flows sequentially, clamped to finish by the master end.
    const startFrame =
      overlayBlock.start === 'from-end'
        ? endAnchorStart
        : Math.min(cumulativeOverlayStart, endAnchorStart);
    if (overlayBlock.start !== 'from-end') {
      cumulativeOverlayStart += resolvedBlockFrames;
    }

    if (overlayBlock.kind === 'staggered-list') {
      resolvedOverlayBlocks.push(
        compileStaggeredListFromTemplate(
          overlayBlock as TemplateStaggeredList,
          script,
          brand,
          bpm,
          startFrame,
          resolvedBlockFrames,
          theme
        )
      );
    } else if (overlayBlock.kind === 'media-overlay') {
      const block = await compileMediaOverlayFromTemplate(
        overlayBlock as TemplateMediaOverlay,
        db,
        organizationId,
        startFrame,
        resolvedBlockFrames
      );
      if (block) resolvedOverlayBlocks.push(block);
    } else if (overlayBlock.kind === 'text') {
      resolvedOverlayBlocks.push(
        compileTextOverlay(
          overlayBlock as TemplateText,
          startFrame,
          resolvedBlockFrames,
          script,
          brand,
          theme
        )
      );
    } else if (overlayBlock.kind === 'info-card') {
      resolvedOverlayBlocks.push(
        compileInfoCardOverlay(
          overlayBlock as TemplateInfoCard,
          startFrame,
          resolvedBlockFrames,
          script,
          brand,
          theme
        )
      );
    }
  }

  // Bake the leaf's width scale into every baked font size so text fits a
  // narrow split pane. No-op for full-width leaves (widthScale === 1).
  if (ctx.widthScale < 1) {
    for (const block of resolvedSpineBlocks)
      scaleBlockFontSizes(block, ctx.widthScale);
    for (const block of resolvedOverlayBlocks)
      scaleBlockFontSizes(block, ctx.widthScale);
  }

  return {
    kind: 'leaf',
    id: leaf.id,
    spine: resolvedSpineBlocks,
    overlays: resolvedOverlayBlocks,
  };
}

// Multiplies every resolved type-style's fontSize on a block by `scale`,
// in place. Centralised so a narrow split pane shrinks all its text — text,
// list, media-overlay label, info-card headline/items/price/cta — uniformly.
// A readability floor stops body/caption text disappearing in a narrow pane:
// the engine's display:body ratio (96:36 ≈ 2.7) is wider than a hand-built
// side-pane's (v1 offer ≈ 36:22), so a uniform scale that lands the oversized
// display headline correctly (96 × 0.4 ≈ 38, matching v1's ~36) would crush
// body to ~14. Flooring keeps body ≈ 22 (v1 parity) while the larger headline
// still scales freely. Never triggers on a full-width leaf (scale 1).
const FLOOR_FONT_SIZE = 22;

export function scaleBlockFontSizes(block: ResolvedBlock, scale: number): void {
  const bump = (style: { fontSize: number } | undefined) => {
    if (style)
      style.fontSize = Math.max(
        FLOOR_FONT_SIZE,
        Math.round(style.fontSize * scale)
      );
  };
  switch (block.kind) {
    case 'text':
      bump(block.typeStyle);
      break;
    case 'staggered-list':
      bump(block.lead?.typeStyle);
      for (const item of block.items) bump(item.typeStyle);
      bump(block.trail?.typeStyle);
      break;
    case 'media-overlay':
      bump(block.label?.typeStyle);
      break;
    case 'info-card':
      // Optional: a logo-only outro has no headline, and every sibling here
      // already optional-chains. Unguarded, such a template threw at compile.
      bump(block.headline?.typeStyle);
      bump(block.items?.typeStyle);
      bump(block.price?.typeStyle);
      bump(block.cta?.typeStyle);
      break;
    default:
      break;
  }
}

async function compileRegion(
  region: TemplateRegion,
  ctx: CompileRegionContext
): Promise<ResolvedRegion> {
  if (region.kind === 'leaf') {
    return compileLeafRegion(region, ctx);
  }
  // Split: compile each child recursively. A horizontal split narrows each
  // child's width by its ratio share (so its baked font sizes shrink to fit the
  // pane); a vertical split leaves width — and therefore the scale — unchanged.
  const totalRatio =
    region.children.reduce((acc, c) => acc + Math.max(0, c.ratio), 0) || 1;
  const resolvedChildren = await Promise.all(
    region.children.map(async (child) => {
      const fraction = Math.max(0, child.ratio) / totalRatio;
      const childCtx: CompileRegionContext =
        region.axis === 'h'
          ? { ...ctx, widthScale: ctx.widthScale * fraction }
          : ctx;
      return {
        ratio: child.ratio,
        region: await compileRegion(child.region, childCtx),
      };
    })
  );
  return {
    kind: 'split',
    axis: region.axis,
    children: resolvedChildren,
  } satisfies ResolvedRegionSplit;
}

export async function compileRenderDoc(
  jobData: VideoRenderJobV2,
  db: Database = defaultDb,
  _log?: Logger
): Promise<RenderDoc> {
  if (jobData.skipCompile) {
    const existing = await db.query.video.findFirst({
      where: eq(video.id, jobData.videoId),
      columns: { renderDoc: true },
    });
    if (existing?.renderDoc) {
      // Existing rows might still be in legacy v1-shape JSON; cast through
      // unknown so the worker can replay them. Wave-2/3 will add a real
      // migration once we have more than one shipped template.
      return refreshRenderDocUrls(existing.renderDoc as unknown as RenderDoc);
    }
  }

  const draftConfig = jobData.draftConfig;
  if (!draftConfig) {
    throw new Error('Cannot compile v2 render doc without draftConfig');
  }

  // Look up the TemplateDoc by ID. Falls back to educational-1 so that
  // pre-wave-7 jobs without a templateDocId still render correctly.
  const templateDocId = jobData.templateDocId ?? 'educational-1';
  const templateDoc = getTemplateDocById(templateDocId);
  if (!templateDoc) {
    throw new Error(`Unknown templateDocId: "${templateDocId}"`);
  }

  const musicTrack = SHARED_MUSIC_TRACKS.find(
    (track) => track.id === draftConfig.musicTrackId
  );

  // Resolve the active Theme. Phase A typically pre-resolves and passes via
  // jobData.theme. Re-resolve when missing (legacy jobs, DLQ retries from
  // before the theme field was added) so the compiler is self-sufficient.
  let theme: Theme;
  if (jobData.theme) {
    theme = jobData.theme;
  } else {
    const themeResult = await getResolvedTheme(db, {
      organizationId: jobData.organizationId,
    });
    theme = themeResult.success ? themeResult.data : engineDefaultTheme;
  }

  const script = buildCompiledScript(draftConfig);
  const bpm = musicTrack?.bpm ?? 100;

  const orientation: RenderOrientation = draftConfig.orientation ?? 'portrait';
  const dimensions = DIMENSIONS_BY_ORIENTATION[orientation];

  // Resolve org name / logo for brand slot resolution (info-card, text blocks).
  const orgRow = await db.query.organization.findFirst({
    where: eq(organization.id, jobData.organizationId),
    columns: { name: true, logo: true },
  });
  const brand: BrandContext = {
    orgName: orgRow?.name ?? '',
    orgLogo: orgRow?.logo ?? undefined,
    // Resolved-theme tagline (brand_kit → engine default) for the brand
    // 'tagline' slot (e.g. the authority logo-hero outro).
    orgTagline: theme.identity.tagline ?? undefined,
  };

  // ── Resolve narration ──
  // draftConfig is the per-video source of truth (mirrors v1 buildVideoConfig):
  // the user picks ai_voiceover / recorded / text_only. The template's static
  // `narration` declaration only signals that the template *supports* voiceover
  // (and, for talking-head templates, which spine clip to lift). We always
  // resolve the audio now so the duration can drive the timeline and the audio
  // URL can be fed to Whisper for caption timing.

  let resolvedNarration: ResolvedNarration | undefined;
  let narrationDurationFrames: number | undefined;
  // Real, fetchable audio URL handed to Whisper for caption timing.
  let captionAudioUrl: string | undefined;

  const narrationCfg = templateDoc.globals.audio.narration;
  const narrationType = draftConfig.narrationType ?? 'text_only';

  if (narrationType === 'ai_voiceover') {
    const ttsResult = await synthesizeTts(db, {
      organizationId: jobData.organizationId,
      script: draftConfig.scriptText ?? '',
      // `voice` exists only on the tts arm of the narration union; the clip arm
      // carries a clipRef and no voice at all.
      voice:
        draftConfig.aiVoiceId ??
        (narrationCfg?.source === 'tts' ? narrationCfg.voice : undefined) ??
        'alloy',
      fps: FPS,
    });
    if (!ttsResult.success) {
      throw new Error(`TTS synthesis failed: ${ttsResult.error.message}`);
    }
    narrationDurationFrames = ttsResult.data.durationFrames;
    const isStub = ttsResult.data.url.startsWith('tts-stub://');
    const ttsKey = isStub
      ? undefined
      : orgAssetsKeyFromTtsUrl(ttsResult.data.url);
    // Renderer needs a presigned URL it can play; Whisper gets the bare key so
    // it downloads via AWS creds (and the caption cache key stays stable).
    resolvedNarration = {
      source: 'tts',
      url:
        isStub || !ttsKey
          ? ttsResult.data.url
          : await getPresignedDownloadUrl({
              bucket: getOrgAssetsBucket(),
              key: ttsKey,
              expiresIn: 3600,
            }),
      startFrame: 0,
      durationInFrames: ttsResult.data.durationFrames,
    };
    captionAudioUrl = isStub ? ttsResult.data.url : ttsKey;
  } else if (narrationType === 'recorded') {
    // Custom / recorded voiceover. Resolve a playable URL + duration from the
    // uploaded audio asset.
    const audioUrl = draftConfig.talkingHeadUrl
      ? await presignS3UrlIfNeeded(draftConfig.talkingHeadUrl)
      : undefined;
    const headAssetId =
      draftConfig.talkingHeadAssetId ?? draftConfig.bRollClips[0]?.assetId;
    if (headAssetId) {
      const row = await db.query.asset.findFirst({
        where: eq(asset.id, headAssetId),
        columns: { duration: true },
      });
      if (row?.duration) {
        narrationDurationFrames = Math.round(row.duration * FPS);
      }
    }
    if (narrationCfg?.source === 'clip') {
      // Talking-head template: lift the spine clip's audio. Validate the ref.
      const target = findBlockById(templateDoc.root, narrationCfg.clipRef);
      if (!target) {
        throw new InvalidClipRefError(
          narrationCfg.clipRef,
          `narration.clipRef "${narrationCfg.clipRef}" does not match any block in template "${templateDoc.id}"`
        );
      }
      resolvedNarration = {
        source: 'clip',
        clipRef: narrationCfg.clipRef,
        lift: true,
        url: audioUrl,
        durationInFrames: narrationDurationFrames,
      };
    } else if (audioUrl) {
      // Standalone uploaded voiceover played over b-roll (e.g. educational).
      resolvedNarration = {
        source: 'tts',
        url: audioUrl,
        startFrame: 0,
        durationInFrames: narrationDurationFrames ?? 0,
      };
    }
    captionAudioUrl = audioUrl;
  }
  // narrationType === 'text_only' → no narration, no captions.

  // ── Build timeline ──

  const { spine: spineBeats, overlays: overlayBeats } = collectLeafBlocks(
    templateDoc.root
  );

  // Compute content-duration overrides for staggered-list overlays so the
  // duration resolver can size them before the timeline is solved.
  const overrides: Record<string, number> = {};
  for (const beat of overlayBeats) {
    if (beat.kind === 'staggered-list') {
      const items = script.items.length;
      const params = beat.params as { stagger: { beatsPerItem: number } };
      const framesPerBeat = (60 / bpm) * FPS;
      const framesPerItem = framesPerBeat * params.stagger.beatsPerItem;
      // lead + items + trail + 1 tail-beat padding
      const totalElements = 1 + items + 1 + 1;
      overrides[beat.id ?? ''] = Math.round(totalElements * framesPerItem);
    }
  }

  const timelineCtx = {
    fps: FPS,
    musicBpm: bpm,
    blockRegistry,
    contentDurationOverrides: overrides,
    narrationDurationFrames,
    resolvedItemCount: script.items.length,
  };

  // When a voiceover is present, the video length follows the narration (v1
  // behaviour) — so captions span the whole video. Otherwise fall back to the
  // template's declared duration (content/staggered-list driven). This keeps
  // educational robust whether the user picked voiceover or text_only, without
  // the template needing to branch.
  const effectiveDuration = narrationDurationFrames
    ? ({ kind: 'fixed', frames: narrationDurationFrames } as const)
    : templateDoc.duration;

  // Master resolution sees every beat so a `driven by <id>` reference (e.g.
  // educational-1's "driven by staggered-list-main") can find its driver. Use
  // resolveMasterFrames (not resolveTimeline) so we don't also resolve every
  // beat's length here — overlays with author-driven content lengths (e.g. an
  // info-card outro) have no computable length and are sized per-leaf below.
  const totalFrames = resolveMasterFrames(
    effectiveDuration,
    [...spineBeats, ...overlayBeats],
    timelineCtx
  );
  const totalDurationSec = totalFrames / FPS;

  // Resolve each leaf's block durations against the shared master.
  //
  // Spine and overlays are PARALLEL tracks (background vs on-top), and split
  // panes are parallel too — so they are resolved per-leaf, never flattened
  // together (which would starve a `fill` block to 1 frame when a sibling
  // already spans the master and render the b-roll invisible).
  //
  // Within a leaf:
  //  - Spine blocks are sequential scenes that tile the master, so they go
  //    through the region resolver (fill absorbs the slack between scenes).
  //  - Overlays are independent, overlap-capable layers (e.g. a persistent
  //    staggered list with an outro info-card fading in over it), so each
  //    resolves its own length — they do NOT have to sum to the master.
  const blockResolvedFrames = new Map<string, number>();

  const resolveOverlayFrames = (beat: BeatInput): number => {
    if (beat.duration.kind === 'fixed') {
      return Math.max(1, Math.round(beat.duration.frames));
    }
    if (beat.duration.kind === 'fill') return totalFrames;
    // content: prefer a compiler-supplied override (e.g. staggered-list item
    // math), else the block's own content-duration calculator.
    if (beat.id !== undefined && overrides[beat.id] !== undefined) {
      return Math.max(1, Math.round(overrides[beat.id] as number));
    }
    const computed = blockRegistry[beat.kind]?.computeContentDuration?.(
      beat.params,
      timelineCtx
    );
    if (computed !== undefined) return Math.max(1, Math.round(computed));
    // Author-driven overlay with no computable content length (e.g. an
    // info-card disclaimer/outro). Span the master as a persistent overlay.
    return totalFrames;
  };

  for (const group of collectLeafGroups(templateDoc.root)) {
    // Spine blocks are PARALLEL full-screen layers, not sequential scenes — the
    // region compiler emits every spine block at startFrame 0 and paints them in
    // order (e.g. media-track then a dark scrim on top). So each block is sized
    // against the master individually; tiling them through resolveTimeline split
    // the master between siblings (a media-track + scrim each got half), which
    // left the second half of the video with no footage → a black tail.
    for (const beat of group.spine) {
      blockResolvedFrames.set(beat.id ?? '', resolveOverlayFrames(beat));
    }
    for (const beat of group.overlays) {
      blockResolvedFrames.set(beat.id ?? '', resolveOverlayFrames(beat));
    }
  }

  // ── Compile region tree ──

  const ctx: CompileRegionContext = {
    db,
    draftConfig,
    totalFrames,
    totalDurationSec,
    bpm,
    script,
    theme,
    organizationId: jobData.organizationId,
    brand,
    blockResolvedFrames,
    widthScale: 1,
  };
  const resolvedRoot = await compileRegion(templateDoc.root, ctx);

  // ── Captions ──
  // Driven by the user's per-video caption toggle (draftConfig.captions), like
  // v1 — not just the template. Requires a resolved narration to transcribe.
  let resolvedCaptions: ResolvedCaptions | undefined;
  const captionsStyleToken = templateDoc.globals.captions?.style ?? 'caption';
  if (draftConfig.captions?.enabled && resolvedNarration && captionAudioUrl) {
    const captionTypeStyle = getTypeStyle(captionsStyleToken, theme);
    let pages: ResolvedCaptionsPage[];

    if (captionAudioUrl.startsWith('tts-stub://')) {
      // No TTS provider key → can't transcribe. Show the script as a single
      // page spanning the video so the render isn't caption-less.
      const text = draftConfig.scriptText ?? '';
      pages = [
        {
          fromFrame: 0,
          toFrame: totalFrames,
          text,
          typeStyle: captionTypeStyle,
          words: [
            { text, startMs: 0, endMs: Math.round((totalFrames / FPS) * 1000) },
          ],
        },
      ];
    } else {
      const captionsResult = await synthesizeCaptions(db, {
        organizationId: jobData.organizationId,
        audioUrl: captionAudioUrl,
        fps: FPS,
        maxWordsPerPage: 5,
        maxPageDurationMs: 1200,
        // Show clean script text (aligned to Whisper timing) so brand names
        // aren't mis-transcribed — v1 parity.
        editedText:
          draftConfig.editedCaptionText ??
          (narrationType === 'ai_voiceover'
            ? draftConfig.scriptText
            : undefined) ??
          undefined,
      });
      if (!captionsResult.success) {
        throw new Error(
          `Captions synthesis failed: ${captionsResult.error.message}`
        );
      }
      pages = captionsResult.data.pages.map((page) => ({
        fromFrame: page.fromFrame,
        toFrame: page.toFrame,
        text: page.text,
        typeStyle: captionTypeStyle,
        words: page.words,
      }));
    }

    resolvedCaptions = {
      pages,
      typeStyle: captionTypeStyle,
      tikTokStyle: tikTokStyleFromDraft(draftConfig.captions),
    };
  }

  return {
    schemaVersion: 2,
    videoId: jobData.videoId,
    templateDocId: jobData.templateDocId ?? templateDoc.id,
    fps: FPS,
    dimensions,
    durationInFrames: totalFrames,
    orientation,
    root: resolvedRoot,
    globals: {
      audio: {
        music: musicTrack
          ? {
              trackId: musicTrack.id,
              // The music registry stores a relative path (e.g.
              // `/public/audio/foo.mp3`). Remotion's <Audio> needs an absolute
              // URL; passing the relative path makes the bundle fetch from its
              // own origin and 404. resolveRegistryMusicUrl normalises it to an
              // absolute CDN/S3 URL (and passes through already-absolute URLs).
              url: resolveRegistryMusicUrl(musicTrack.path),
              volume: draftConfig.musicVolume ?? 0.5,
              bpm: musicTrack.bpm,
            }
          : undefined,
        narration: resolvedNarration,
      },
      captions: resolvedCaptions,
      theme,
    },
  };
}

// ── Wave-2 block compilers ──────────────────────────────────────────
//
// These take a TemplateDoc-side block (with Slot<T> fields) and produce the
// matching Resolved*Block shape. They're not yet called from `compileRenderDoc`
// because the educational-1 happy path doesn't author against these kinds —
// the gate/slot resolution machinery that would fill these in is wave-4 work.
//
// Today these helpers exist so:
//  1. The compiler module has the symmetry: every block kind in the registry
//     has a compile path here.
//  2. The editor's stub-synthesize can either call into these or mirror them
//     when wave-4 wires slot resolution into the worker proper.
//  3. The Phase-A → Phase-B handoff for the next template (before-after-1,
//     punch-list P5.23) has a place to plug in without re-shaping the compiler.
//
// All slot resolution is TODO(wave-4) — the helpers currently take pre-resolved
// concrete values (the caller resolves slots first) and emit framed shapes.

interface CompileTextInput {
  block: TemplateText;
  startFrame: number;
  durationInFrames: number;
  /** Slot-resolved text. TODO(wave-4): wire script-text slot resolution. */
  text: string;
  /** Active Theme. REQUIRED: this block's styles go through resolveStyle(),
   *  which reads theme.colors for an override's colorRole — undefined would
   *  throw. The only caller has always passed one. */
  theme: Theme;
}

export function compileTextBlock({
  block,
  startFrame,
  durationInFrames,
  text,
  theme,
}: CompileTextInput): ResolvedTextBlock {
  return {
    kind: 'text',
    id: block.id,
    startFrame,
    durationInFrames,
    text,
    typeStyle: resolveStyle(block.style, theme, block.styleOverride),
    entrance: block.animation.entrance,
    entranceDurationFrames: block.animation.entranceDurationFrames,
    entranceDelayFrames: block.animation.entranceDelayFrames,
    container: block.container,
    placement: block.placement,
  };
}

interface CompileMediaOverlayInput {
  block: TemplateMediaOverlay;
  startFrame: number;
  durationInFrames: number;
  /** Slot-resolved clip. TODO(wave-4): wire asset-media slot resolution. */
  clip: ResolvedMediaClip;
  /** Optional resolved label text when block.label.text is a slot. */
  labelText?: string;
  /** Active Theme. REQUIRED: this block's styles go through resolveStyle(),
   *  which reads theme.colors for an override's colorRole — undefined would
   *  throw. The only caller has always passed one. */
  theme: Theme;
}

export function compileMediaOverlayBlock({
  block,
  startFrame,
  durationInFrames,
  clip,
  labelText,
  theme,
}: CompileMediaOverlayInput): ResolvedMediaOverlayBlock {
  return {
    kind: 'media-overlay',
    id: block.id,
    startFrame,
    durationInFrames,
    clip,
    placement: block.placement,
    fit: block.fit,
    kenBurns: block.kenBurns,
    label:
      block.label && labelText !== undefined
        ? {
            text: labelText,
            typeStyle: resolveStyle(
              block.label.style,
              theme,
              block.label.styleOverride
            ),
            corner: block.label.corner,
          }
        : undefined,
  };
}

interface CompileInfoCardInput {
  block: TemplateInfoCard;
  startFrame: number;
  durationInFrames: number;
  // TODO(wave-4): wire script-text and brand slot resolution.
  headlineText?: string;
  itemsTexts?: string[];
  priceValue?: string;
  priceCurrency?: string;
  ctaText?: string;
  ctaUrl?: string;
  logoUrl?: string;
  /** Active Theme; wave 5 (§17) bakes themed type-styles into resolved blocks. */
  theme?: Theme;
}

export function compileInfoCardBlock({
  block,
  startFrame,
  durationInFrames,
  headlineText,
  itemsTexts,
  priceValue,
  priceCurrency,
  ctaText,
  ctaUrl,
  logoUrl,
  theme,
}: CompileInfoCardInput): ResolvedInfoCardBlock {
  return {
    kind: 'info-card',
    id: block.id,
    startFrame,
    durationInFrames,
    layout: block.layout,
    headline:
      block.headline && headlineText !== undefined
        ? {
            text: headlineText,
            typeStyle: getTypeStyle(block.headline.style, theme),
          }
        : undefined,
    items:
      block.items && itemsTexts
        ? {
            texts: itemsTexts,
            typeStyle: getTypeStyle(block.items.style, theme),
          }
        : undefined,
    // Only emit a price when there's an actual value. Organic offers carry a
    // placeholder empty price (the converter backfills it per-video for v1
    // re-renders), and a currency with no amount would render as a bare "USD".
    price:
      block.price &&
      priceValue !== undefined &&
      priceValue.trim().length > 0 &&
      priceCurrency !== undefined
        ? {
            value: priceValue,
            currency: priceCurrency,
            typeStyle: getTypeStyle(block.price.style, theme),
          }
        : undefined,
    cta:
      block.cta && ctaText !== undefined
        ? {
            text: ctaText,
            url: ctaUrl,
            typeStyle: getTypeStyle(block.cta.style, theme),
          }
        : undefined,
    logo:
      block.logo && logoUrl !== undefined
        ? {
            url: logoUrl,
            position: block.logo.position,
            size: block.logo.size,
          }
        : undefined,
    background: block.background,
    // Bake the brand accent so the renderer fills the CTA / bullet markers
    // on-brand (matches v1's primaryColor offer button) instead of a neutral
    // fallback. onColor keeps the CTA label readable on the accent fill.
    accent: theme
      ? { color: theme.colors.primary, onColor: theme.colors.onPrimary }
      : undefined,
    entrance: block.entrance.animation,
    entranceDurationFrames: block.entrance.entranceDurationFrames,
    placement: block.placement,
  };
}

interface CompileSolidInput {
  block: TemplateSolid;
  startFrame: number;
  durationInFrames: number;
  /** Slot-resolved colour. TODO(wave-4): wire brand slot resolution. */
  color: string;
}

export function compileSolidBlock({
  block,
  startFrame,
  durationInFrames,
  color,
}: CompileSolidInput): ResolvedSolidBlock {
  return {
    kind: 'solid',
    id: block.id,
    startFrame,
    durationInFrames,
    color,
  };
}
