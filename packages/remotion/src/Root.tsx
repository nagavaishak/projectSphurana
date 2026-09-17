import type React from 'react';
import { Composition } from 'remotion';
import {
  SandboxComposition,
  type SandboxCompositionProps,
  sandboxCompositionSchema,
} from './components/sandbox-composition';
import { SquareOfferComposition } from './components/square-offer-composition';
import { TemplateRenderer } from './components/template-renderer';
import { VideoComposition } from './components/video-composition';
import { renderDocSchema } from './types/render-doc-schema';
import {
  type CaptionTeaseConfig,
  DEFAULT_CAPTION_STYLE,
  DEFAULT_FPS,
  DEFAULT_TIKTOK_CAPTION_STYLE,
  type ImprovesConfig,
  type InsOutsConfig,
  LANDSCAPE_DIMENSIONS,
  PORTRAIT_DIMENSIONS,
  type QuestionCtaConfig,
  SQUARE_DIMENSIONS,
  type VideoConfig,
  videoConfigSchema,
} from './types/video-config';

// Cast components to satisfy Remotion's strict typing - type safety is enforced by the schema prop
// biome-ignore lint/suspicious/noExplicitAny: Required for Remotion Composition component type compatibility
const TypedVideoComposition = VideoComposition as React.FC<any>;
// biome-ignore lint/suspicious/noExplicitAny: Required for Remotion Composition component type compatibility
const TypedSquareOfferComposition = SquareOfferComposition as React.FC<any>;
// biome-ignore lint/suspicious/noExplicitAny: Required for Remotion Composition component type compatibility
const TypedTemplateRenderer = TemplateRenderer as React.FC<any>;
// biome-ignore lint/suspicious/noExplicitAny: Required for Remotion Composition component type compatibility
const TypedSandboxComposition = SandboxComposition as React.FC<any>;

const sandboxDefaultProps: SandboxCompositionProps = {
  backgroundColor: '#F5F5F0',
  verticalPosition: 0.35,
  horizontalPaddingPercent: 8,
  typewriter: {
    text: 'Real clients.\nReal results.',
    charsPerSecond: 18,
    jitterFrames: 3,
    spacePauseMultiplier: 0.6,
    commaPauseMultiplier: 3,
    sentencePauseMultiplier: 6,
    seed: 1,
    startFrame: 6,
    showCursor: true,
    cursorChar: '|',
    cursorBlinkFrames: 15,
    cursorPersists: true,
    fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: 900,
    fontSize: 120,
    fillColor: '#000000',
    strokeColor: '#FFFFFF',
    strokeWidth: 6,
    letterSpacing: '-0.02em',
    lineHeight: 1.1,
    textTransform: 'none',
    textAlign: 'center',
    textShadow: undefined,
  },
};

/**
 * Default props for Remotion compositions.
 * These are used when previewing in the Remotion Studio.
 * In production, inputProps are passed from the Lambda render call.
 */
const defaultProps: VideoConfig = {
  scenes: [],
  captionPages: [],
  tikTokCaptionStyle: DEFAULT_TIKTOK_CAPTION_STYLE,
  captions: [],
  captionStyle: DEFAULT_CAPTION_STYLE,
  orientation: 'portrait',
  fps: DEFAULT_FPS,
  durationInFrames: 300, // 10 seconds at 30fps
  // Studio preview stub: VideoComposition throws if nothing is present.
  // Real renders override these via inputProps from Lambda.
  textFrames: [
    {
      id: 'studio-preview',
      text: 'Studio preview — pass real inputProps from Lambda',
      startFrame: 0,
      durationInFrames: 300,
    },
  ],
};

// ─── Organic template default props (Remotion Studio smoke tests) ──────
// 8s baseline duration, empty scenes (renders on a black background so the
// text layer is the focus). Producers can override these via the schema
// panel to test with real footage.

const ORGANIC_DURATION_FRAMES = 8 * DEFAULT_FPS; // 8 seconds

const CAPTION_TEASE_DEFAULT: CaptionTeaseConfig = {
  headline:
    'This ONE treatment reduces flaky patches & rough skin by up to 70%',
  emphasis: 'ONE',
  emoji: '🤯',
  caption: 'Check the caption',
  charsPerSecond: 28,
};

const INS_OUTS_DEFAULT: InsOutsConfig = {
  title: '2026 SKINCARE INS + OUTS',
  insLabel: 'INS',
  insItems: [
    'Microneedling',
    'Professional skin treatments',
    'Daily SPF (yes, even indoors)',
    'LED light therapy',
    'Nutrition',
    'Lightweight moisturisers',
    'Consistent sleep',
    'Stress management',
  ],
  outsLabel: 'OUTS',
  outsItems: [
    'Sunbeds',
    'Too much alcohol',
    'DIY treatments',
    'Harsh exfoliants',
    'Skipping SPF',
  ],
};

const QUESTION_CTA_DEFAULT: QuestionCtaConfig = {
  question: 'How long should your botox last?',
  ctaText: 'Read caption ⬇',
};

const IMPROVES_DEFAULT: ImprovesConfig = {
  serviceName: 'MICRONEEDLING',
  improvesLabel: 'IMPROVES:',
  items: ['SKIN TEXTURE', 'FINE LINES', 'ACNE SCARS'],
  ctaText: 'Start your microneedling journey today',
};

const captionTeaseDefaultProps: VideoConfig = {
  ...defaultProps,
  variationId: 'caption-tease-1',
  durationInFrames: ORGANIC_DURATION_FRAMES,
  captionTease: CAPTION_TEASE_DEFAULT,
};

const insOutsDefaultProps: VideoConfig = {
  ...defaultProps,
  variationId: 'ins-outs-1',
  durationInFrames: ORGANIC_DURATION_FRAMES,
  insOuts: INS_OUTS_DEFAULT,
};

const questionCtaDefaultProps: VideoConfig = {
  ...defaultProps,
  variationId: 'question-cta-1',
  durationInFrames: ORGANIC_DURATION_FRAMES,
  questionCta: QUESTION_CTA_DEFAULT,
};

// Improves: 1 opening + 3 items + 1 cta = 5 segments × 1.6s
const improvesDefaultProps: VideoConfig = {
  ...defaultProps,
  variationId: 'improves-1',
  durationInFrames: Math.round(
    (IMPROVES_DEFAULT.items.length + 2) * 1.6 * DEFAULT_FPS
  ),
  improves: IMPROVES_DEFAULT,
};

// Renderer-agnostic RenderDoc default props (§15.1). Shape mirrors
// @borradh-workspace/video-templates#RenderDoc but kept inline here so this
// file has no compile-time coupling to the engine package.
const templateRendererDefaultPropsBase = {
  schemaVersion: 2 as const,
  videoId: 'studio-preview',
  templateDocId: 'educational-1',
  fps: 30,
  durationInFrames: 900,
  root: { kind: 'leaf' as const, id: 'main', spine: [], overlays: [] },
  globals: { audio: {} },
};

/**
 * Root component for Remotion
 *
 * This registers all compositions that can be rendered.
 * The Lambda service uses composition IDs to select which to render:
 * - 'PortraitVideo' for 1080x1920 (9:16) vertical videos
 * - 'LandscapeVideo' for 1920x1080 (16:9) horizontal videos
 * - 'SquareVideo' for 1080x1080 (1:1) square offer videos
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Portrait composition (1080x1920 - 9:16 aspect ratio) */}
      <Composition
        id="PortraitVideo"
        component={TypedVideoComposition}
        durationInFrames={300}
        fps={DEFAULT_FPS}
        width={PORTRAIT_DIMENSIONS.width}
        height={PORTRAIT_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={defaultProps}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />

      {/* Landscape composition (1920x1080 - 16:9 aspect ratio) */}
      <Composition
        id="LandscapeVideo"
        component={TypedVideoComposition}
        durationInFrames={300}
        fps={DEFAULT_FPS}
        width={LANDSCAPE_DIMENSIONS.width}
        height={LANDSCAPE_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={{ ...defaultProps, orientation: 'landscape' as const }}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />

      {/* ─── Organic templates (portrait 1080x1920) ──────────────────── */}
      <Composition
        id="OrganicCaptionTease"
        component={TypedVideoComposition}
        durationInFrames={captionTeaseDefaultProps.durationInFrames}
        fps={DEFAULT_FPS}
        width={PORTRAIT_DIMENSIONS.width}
        height={PORTRAIT_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={captionTeaseDefaultProps}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />
      <Composition
        id="OrganicInsOuts"
        component={TypedVideoComposition}
        durationInFrames={insOutsDefaultProps.durationInFrames}
        fps={DEFAULT_FPS}
        width={PORTRAIT_DIMENSIONS.width}
        height={PORTRAIT_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={insOutsDefaultProps}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />
      <Composition
        id="OrganicQuestionCta"
        component={TypedVideoComposition}
        durationInFrames={questionCtaDefaultProps.durationInFrames}
        fps={DEFAULT_FPS}
        width={PORTRAIT_DIMENSIONS.width}
        height={PORTRAIT_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={questionCtaDefaultProps}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />
      <Composition
        id="OrganicImproves"
        component={TypedVideoComposition}
        durationInFrames={improvesDefaultProps.durationInFrames}
        fps={DEFAULT_FPS}
        width={PORTRAIT_DIMENSIONS.width}
        height={PORTRAIT_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={improvesDefaultProps}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />

      {/* Sandbox composition for iterating on TypewriterText + StrokedText.
          Edit props live in the Studio sidebar (driven by sandboxCompositionSchema). */}
      <Composition
        id="Sandbox"
        component={TypedSandboxComposition}
        durationInFrames={300}
        fps={DEFAULT_FPS}
        width={PORTRAIT_DIMENSIONS.width}
        height={PORTRAIT_DIMENSIONS.height}
        schema={sandboxCompositionSchema}
        defaultProps={sandboxDefaultProps}
      />

      {/* Square composition (1080x1080 - 1:1 aspect ratio, side-by-side offer layout) */}
      <Composition
        id="SquareVideo"
        component={TypedSquareOfferComposition}
        durationInFrames={600}
        fps={DEFAULT_FPS}
        width={SQUARE_DIMENSIONS.width}
        height={SQUARE_DIMENSIONS.height}
        schema={videoConfigSchema}
        defaultProps={{
          ...defaultProps,
          orientation: 'square' as const,
          offerCard: {
            serviceName: 'Premium Treatment',
            headline: 'ACHIEVE FIRMER SMOOTHER YOUTHFUL LOOKING SKIN',
            bulletPoints: [
              'Non-Invasive Treatment',
              'Safe For All Skin Types',
              'Results In Just 3 Sessions',
            ],
            ctaText: 'Book Now',
            primaryColor: '#007AFF',
          },
        }}
        calculateMetadata={({ props }) => {
          const typedProps = props as VideoConfig;
          return {
            durationInFrames: typedProps.durationInFrames,
            fps: typedProps.fps,
          };
        }}
      />
      <Composition
        id="TemplateRendererPortrait"
        component={TypedTemplateRenderer}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1920}
        schema={renderDocSchema}
        defaultProps={{
          ...templateRendererDefaultPropsBase,
          orientation: 'portrait' as const,
          dimensions: {
            width: PORTRAIT_DIMENSIONS.width,
            height: PORTRAIT_DIMENSIONS.height,
          },
        }}
        calculateMetadata={({ props }) => {
          const doc = props as { durationInFrames?: number; fps?: number };
          return {
            durationInFrames: doc.durationInFrames ?? 900,
            fps: doc.fps ?? 30,
          };
        }}
      />
      <Composition
        id="TemplateRendererLandscape"
        component={TypedTemplateRenderer}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
        schema={renderDocSchema}
        defaultProps={{
          ...templateRendererDefaultPropsBase,
          orientation: 'landscape' as const,
          dimensions: {
            width: LANDSCAPE_DIMENSIONS.width,
            height: LANDSCAPE_DIMENSIONS.height,
          },
        }}
        calculateMetadata={({ props }) => {
          const doc = props as { durationInFrames?: number; fps?: number };
          return {
            durationInFrames: doc.durationInFrames ?? 900,
            fps: doc.fps ?? 30,
          };
        }}
      />
      <Composition
        id="TemplateRendererSquare"
        component={TypedTemplateRenderer}
        durationInFrames={900}
        fps={30}
        width={1080}
        height={1080}
        schema={renderDocSchema}
        defaultProps={{
          ...templateRendererDefaultPropsBase,
          orientation: 'square' as const,
          dimensions: {
            width: SQUARE_DIMENSIONS.width,
            height: SQUARE_DIMENSIONS.height,
          },
        }}
        calculateMetadata={({ props }) => {
          const doc = props as { durationInFrames?: number; fps?: number };
          return {
            durationInFrames: doc.durationInFrames ?? 900,
            fps: doc.fps ?? 30,
          };
        }}
      />
    </>
  );
};
