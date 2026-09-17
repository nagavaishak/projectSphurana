import { z } from 'zod';
import type { OutroLayoutConfig } from './outro-layouts';

/**
 * Video orientation options
 */
export type VideoOrientation = 'portrait' | 'landscape' | 'square';

/**
 * Transition types between scenes
 */
export type TransitionType =
  | 'none'
  | 'fade'
  | 'slide-left'
  | 'slide-right'
  | 'wipe';

/**
 * Caption position options
 */
export type CaptionPosition = 'top' | 'center' | 'bottom';

/**
 * B-roll clip type for beauty clinic videos
 */
export type BRollClipType = 'before' | 'after' | 'procedure';

/**
 * Scene - represents a single video clip in the timeline
 */
export interface Scene {
  id: string;
  /** URL of the video clip (S3 presigned URL) */
  clipUrl: string;
  /** Type of scene - talking head or b-roll overlay */
  type: 'talking-head' | 'b-roll';
  /** Frames to trim from the start of the source clip */
  trimStart: number;
  /** Frames to trim from the end of the source clip */
  trimEnd: number;
  /** Position in the overall timeline (frame number) */
  startFrame: number;
  /** Duration of this scene after trimming (in frames) */
  durationInFrames: number;
  /** Optional transition to apply when entering this scene */
  transition?: TransitionType;
  /** B-roll clip type (only for b-roll scenes) */
  bRollType?: BRollClipType;
  /** Media type - video (default) or still image */
  mediaType?: 'video' | 'image';
}

/**
 * Word token for TikTok-style captions with word-by-word highlighting
 */
export interface CaptionWord {
  /** The word text */
  text: string;
  /** Start time in milliseconds */
  startMs: number;
  /** End time in milliseconds */
  endMs: number;
}

/**
 * Caption page - a group of words displayed together (TikTok style)
 */
export interface CaptionPage {
  id: string;
  /** Words in this caption page */
  words: CaptionWord[];
  /** Frame when this page appears */
  startFrame: number;
  /** Frame when this page disappears */
  endFrame: number;
}

/**
 * Legacy caption format (single text block)
 */
export interface Caption {
  id: string;
  /** The text content of the caption */
  text: string;
  /** Frame when caption appears */
  startFrame: number;
  /** Frame when caption disappears */
  endFrame: number;
}

/**
 * TikTok-style caption styling options
 */
export interface TikTokCaptionStyle {
  /** Vertical position on screen */
  position: CaptionPosition;
  /** Font family */
  fontFamily: string;
  /** Font size in pixels */
  fontSize: number;
  /** Default text color (hex or CSS color) */
  color: string;
  /** Highlighted word color (the active word) */
  highlightColor: string;
  /** Background color for caption box */
  backgroundColor: string;
  /** Whether to show the background behind text */
  showBackground: boolean;
  /** Text stroke width for contrast */
  strokeWidth: number;
  /** Text stroke color */
  strokeColor: string;
}

/**
 * Legacy caption styling options
 */
export interface CaptionStyle {
  /** Vertical position on screen */
  position: CaptionPosition;
  /** Font family */
  fontFamily: string;
  /** Font size in pixels */
  fontSize: number;
  /** Text color (hex or CSS color) */
  color: string;
  /** Background color for caption box */
  backgroundColor: string;
  /** Whether to show the background behind text */
  showBackground: boolean;
}

/**
 * Background music configuration
 */
export interface MusicConfig {
  /** ID of the music track */
  trackId: string;
  /** URL of the audio file */
  url: string;
  /** Volume level (0-1) */
  volume: number;
}

/**
 * Legacy outro/branding configuration (full screen)
 */
export interface OutroConfig {
  /** Call-to-action text */
  ctaText: string;
  /** Background color */
  backgroundColor: string;
  /** Text color */
  textColor: string;
  /** Optional logo URL */
  logoUrl?: string;
  /** Duration of outro in frames */
  durationInFrames: number;
}

/**
 * Template variation IDs
 * Each variation has specific rendering behavior for b-roll and talking head visibility
 */
export type TemplateVariationId =
  | 'authority-1'
  | 'before-after-1'
  | 'educational-1'
  | 'educational-2'
  | 'educational-3'
  | 'offer-square-1'
  | 'testimonial-1'
  | 'testimonial-2'
  | 'testimonial-3'
  | 'caption-tease-1'
  | 'ins-outs-1'
  | 'question-cta-1'
  | 'improves-1'
  | 'fade-benefits-1'
  | 'aesthetic-line-1'
  | 'numbered-list-1'
  | 'highlight-caption-1'
  | 'curiosity-hook-1'
  | 'step-timer-1'
  | 'time-progress-1'
  | 'poll-1'
  | 'myth-fact-1'
  | 'versus-1'
  | 'price-reveal-1'
  | 'client-question-1'
  | 'come-with-me-1';

/**
 * Text frame style for text-only videos (no voice, text on screen)
 */
export type TextFrameStyle =
  | 'default'
  | 'question'
  | 'answer'
  | 'disclaimer'
  | 'cta';

/**
 * A single timed text frame for text-only narration mode.
 * Each frame appears at its startFrame for its duration.
 */
export interface TextFrame {
  id: string;
  /** The text to display */
  text: string;
  /** Frame when this text appears */
  startFrame: number;
  /** How long this text is visible (in frames) */
  durationInFrames: number;
  /** Visual style for the text */
  style?: TextFrameStyle;
}

/**
 * Offer card overlay for promotion videos (text/music only, no voice)
 */
export interface OfferCard {
  /** Service or treatment name */
  serviceName: string;
  /** Short description of the service */
  serviceDescription?: string;
  /** ALL CAPS headline for the offer pane (square format) */
  headline?: string;
  /** Original price in cents (e.g. 35000 = €350) */
  originalPriceCents?: number;
  /** Offer price in cents (e.g. 15500 = €155) */
  offerPriceCents?: number;
  /** Discount percentage (e.g. 50) */
  discountPercent?: number;
  /** Key selling points */
  bulletPoints?: string[];
  /** Call-to-action text */
  ctaText: string;
  /** Urgency/scarcity text */
  urgencyText?: string;
  /** Who the offer is for */
  audienceText?: string;
  /** Logo URL */
  logoUrl?: string;
  /** Business name */
  businessName?: string;
  /** Brand accent color (hex) */
  primaryColor?: string;
  /** Secondary brand color (hex) */
  secondaryColor?: string;
  /** Currency code for formatting (default: EUR) */
  currencyCode?: string;
}

/**
 * Educational video configuration - progressive stacking layout
 * Question at top, items slide in one by one and stay visible, CTA at bottom
 */
export interface EducationalConfig {
  /** Serif italic question text, displayed in brand primary color */
  questionText: string;
  /** White pill-shaped items, dark text, uppercase - slide in and stay */
  items: string[];
  /** CTA button text - brand primary BG, white text */
  ctaText: string;
  /** Brand accent color (hex) */
  primaryColor: string;
  /** Music BPM for beat-synced entrances */
  bpm?: number;
  /** Beats between each item entrance (default: 4) */
  beatsPerItem?: number;
}

/**
 * Organic template: caption-tease.
 * Centered serif headline with optional emphasis word + emoji, cursive caption
 * directly underneath, both revealed character-by-character (typewriter).
 */
export interface CaptionTeaseConfig {
  /** The full headline string (serif). */
  headline: string;
  /** Optional substring of `headline` to render bold for emphasis (e.g. "ONE"). */
  emphasis?: string;
  /** Optional trailing emoji appended to the headline. */
  emoji?: string;
  /** Secondary caption text (cursive script, e.g. "Check the caption"). */
  caption: string;
  /** Characters revealed per second. Default: 28. */
  charsPerSecond?: number;
}

/**
 * Organic template: fade-in benefits.
 * Short benefit statements revealed word-by-word with a soft fade (centered
 * serif, lower third), one statement at a time over the b-roll.
 */
export interface FadeBenefitsConfig {
  /** Ordered benefit statements; each fades in word-by-word, one at a time. */
  lines: string[];
  /** Seconds each statement holds, including its word reveal. Default: 2.6 */
  secondsPerLine?: number;
  /**
   * "Highlight Caption" mode (the trending reel format): render each whole
   * line on a solid brand-colour highlight block with a single fade-in,
   * instead of the word-by-word serif reveal. Drives the `highlight-caption`
   * organic template through the shared fade-benefits render path.
   */
  highlight?: boolean;
  /** Fill colour for highlight blocks (the org's brand primary). */
  primaryColor?: string;
}

/**
 * Organic template: aesthetic line.
 * A single understated serif line, lower third, with a gentle fade-in that
 * holds for the whole clip over the b-roll.
 */
export interface AestheticLineConfig {
  /** The single line of text shown for the whole clip. */
  text: string;
}

/**
 * Organic template: numbered list.
 * Bold uppercase title at the top, then a numbered list (1..N) with small
 * number badges over a darkened b-roll. Items reveal one-by-one.
 */
export interface NumberedListConfig {
  /** Uppercase title shown at the top. */
  title: string;
  /** Ordered list items — each gets an auto-incrementing number badge. */
  items: string[];
  /** Brand accent for the number badges. */
  primaryColor?: string;
}

/**
 * Organic template: ins-outs.
 * Title at top, then two named sections (INS / OUTS) of single-line items.
 * Items never wrap — they auto-shrink to fit the safe-area width.
 */
export interface InsOutsConfig {
  /** Title shown at the top (uppercase, bold). */
  title: string;
  /** Label for the positive section (default: "INS"). */
  insLabel?: string;
  /** Items listed under INS — each rendered on a single line. */
  insItems: string[];
  /** Label for the negative section (default: "OUTS"). */
  outsLabel?: string;
  /** Items listed under OUTS — each rendered on a single line. */
  outsItems: string[];
  /** Brand accent for the section-label pills. */
  primaryColor?: string;
}

/**
 * Organic template: question-cta.
 * Top question text + bottom "Read caption ⬇" style CTA.
 * Uses inverted style: black fill with thick white stroke.
 */
export interface QuestionCtaConfig {
  /** Question or hook displayed at the top of the frame. */
  question: string;
  /** Call-to-action displayed at the bottom (e.g. "Read caption ⬇"). */
  ctaText: string;
  /** Brand accent for the CTA pill. */
  primaryColor?: string;
}

/**
 * Organic template: improves.
 * Per-clip synced text: 1 opening clip (service name) + N improvement clips
 * (each shows "IMPROVES:" header + a different item) + 1 closing CTA clip.
 * Text segments are derived from `scenes` ordering at render time.
 */
export interface ImprovesConfig {
  /** Service name shown on the opening clip (uppercase, large). */
  serviceName: string;
  /** Header shown above each improvement item. Default: "IMPROVES:". */
  improvesLabel?: string;
  /** Improvement items — one per middle clip. */
  items: string[];
  /** Closing call-to-action shown on the final clip. */
  ctaText: string;
  /** Brand accent for the improves-label chip. */
  primaryColor?: string;
}

/**
 * Organic template: step-timer.
 * Persistent bold uppercase title, then numbered timed steps revealed one per
 * b-roll clip (a centered number badge + "label" + a "duration" pill) over a
 * darkened scrim. Save-worthy routine/protocol content.
 */
export interface StepTimerConfig {
  /** Bold uppercase title shown at the top for the whole video. */
  title: string;
  /** Ordered steps — one revealed per clip, each with an auto number badge. */
  steps: Array<{ label: string; duration: string }>;
  /** Brand accent for the duration chip + progress segments. */
  primaryColor?: string;
  /** Dark companion of the accent — small text on light chips. */
  secondaryColor?: string;
}

/**
 * Organic template: time-lapse progress.
 * A large "startLabel → endLabel" timestamp (e.g. "Day 1 → Day 30") plus a
 * caption, held over before→after footage. Black-on-white-stroke for contrast.
 */
export interface TimeProgressConfig {
  /** Left side of the timestamp (e.g. "Day 1"). */
  startLabel: string;
  /** Right side of the timestamp (e.g. "Day 30"). */
  endLabel: string;
  /** Supporting caption shown beneath the timestamp. */
  caption: string;
  /** Brand accent for the header-band tick. */
  primaryColor?: string;
  /** Clinic wordmark shown on the right of the header band. */
  businessName?: string;
}

/**
 * Organic template: myth → fact debunk. Red MYTH pill + statement card that
 * flips to the green FACT correction, one pair per two beats.
 */
export interface MythFactConfig {
  /** Optional persistent series label (e.g. "SKINCARE MYTHS"). */
  seriesTitle?: string;
  /** Myth/fact pairs, revealed myth-then-fact. */
  pairs: Array<{ myth: string; fact: string }>;
  /** Optional closing CTA beat. */
  ctaText?: string;
}

/**
 * Organic template: X vs Y treatment comparison. Stacked name cards, then
 * attribute rounds, closing on an it-depends verdict card.
 */
export interface VersusConfig {
  treatmentA: string;
  treatmentB: string;
  rounds: Array<{ label: string; aValue: string; bValue: string }>;
  /** The verdict — "depends on goal X vs Y", never a winner. */
  verdict: string;
  /** Brand accent for pills. */
  primaryColor?: string;
}

/**
 * Organic template: price transparency. Receipt rows build per beat, total
 * stamps down on the final beat.
 */
export interface PriceRevealConfig {
  /** The price question hook. */
  hook: string;
  items: Array<{ name: string; price: string }>;
  totalPrice: string;
  /** Optional "worth £X" comparison line under the total. */
  valueLine?: string;
  /** Brand accent for the total pill. */
  primaryColor?: string;
}

/**
 * Organic template: pinned client question. A reply-sticker bubble persists
 * top-left while answer beats swap in the lower third.
 */
export interface ClientQuestionConfig {
  /** The client's question, first-person casual. */
  question: string;
  /** Anonymised asker display name (e.g. "sarah_x"). */
  asker: string;
  /** Answer beats — the first answers directly, the rest add nuance. */
  answers: string[];
  /** Closing comment-prompt CTA. */
  ctaText?: string;
}

/**
 * Organic template: "come with me" mini-vlog. Script title beat, lowercase
 * diary step captions, closing clinic CTA.
 */
export interface ComeWithMeConfig {
  /** The invitation title (lowercase, "come ..."). */
  title: string;
  /** Optional series chip (e.g. "ep. 4"). */
  seriesChip?: string;
  /** Lowercase sensory step captions, one per beat. */
  steps: string[];
  closingCta: string;
}

/**
 * Organic template: poll / this-or-that.
 * Question top, two numbered option cards centred, "Comment 1 or 2 to vote"
 * CTA bottom. Votes are tallied from post comments by the social-poll loop.
 */
export interface PollConfig {
  /** The poll question. */
  question: string;
  /** Option voted by liking the post. */
  likeLabel: string;
  /** Option voted by commenting. */
  commentLabel: string;
  /** Optional third option voted by sharing. */
  shareLabel?: string;
  /** Brand accent for the filled row + action chips. */
  primaryColor?: string;
  /** Dark companion of the accent — small text on light rows. */
  secondaryColor?: string;
}

/**
 * Text interstitial overlay - animated text at a configurable position.
 * Used for transition text like "CLIENT RESULTS COMING NOW" between scenes.
 */
export interface TextInterstitial {
  /** The text to display */
  text: string;
  /** Frame when the text appears */
  startFrame: number;
  /** How long the text is visible (in frames) */
  durationInFrames: number;
  /** Vertical position as fraction of viewport height (0 = top, 1 = bottom). Default: 0.33 */
  verticalPosition?: number;
  /** Font size in pixels. Default: 72 */
  fontSize?: number;
  /** Optional sound effect URL to play on appear */
  soundEffectUrl?: string;
}

/**
 * Full-screen reveal - dramatic full-screen image/video transition with Ken Burns zoom.
 * Used for "after" reveals and other cinematic full-screen transitions.
 */
export interface FullScreenReveal {
  /** URL of the image or video */
  src: string;
  /** Whether the source is an image or video */
  mediaType: 'image' | 'video';
  /** Frame when the reveal starts */
  startFrame: number;
  /** How long the reveal is visible (in frames) */
  durationInFrames: number;
  /** Trim start for video sources (in frames). Default: 0 */
  trimStart?: number;
  /** Ken Burns zoom range [start, end]. Default: [1.0, 1.12] */
  zoomRange?: [number, number];
  /** Transition type for entering. Default: 'fade' */
  transition?: TransitionType;
  /** Transition duration in frames. Default: 8 */
  transitionDurationFrames?: number;
  /** Optional label text (e.g., "AFTER") */
  label?: string;
  /** Label position. Default: 'top-left' */
  labelPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Optional sound effect URL to play on appear */
  soundEffectUrl?: string;
  /** Sound effect volume (0-1). Default: 0.5 */
  soundEffectVolume?: number;
}

/**
 * Picture-in-Picture overlay - small photo thumbnail in the corner
 */
export interface PipOverlay {
  /** URL of the image to display */
  imageUrl: string;
  /** Label text (e.g., "BEFORE", "AFTER") */
  label?: string;
  /** Position on screen */
  position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  /** Frame when the overlay appears */
  startFrame: number;
  /** How long the overlay is visible (in frames) */
  durationInFrames: number;
  /** Size as percentage of viewport width (default: 20) */
  sizePercent?: number;
  /** Optional sound effect URL to play on appear */
  soundEffectUrl?: string;
}

/**
 * Main video configuration - this is passed as inputProps to the Remotion Player
 *
 * Audio Sync Architecture:
 * - The talking head audio track plays continuously throughout the video
 * - B-roll clips are layered on top visually (video only, muted)
 * - When b-roll is visible, talking head video is hidden but its audio continues
 * - This ensures seamless audio continuity even during visual cutaways
 *
 * Caption Architecture:
 * - TikTok-style captions with word-by-word highlighting
 * - Words are grouped into "pages" that display together
 * - Active word is highlighted in a different color
 * - Captions are transcribed from talking head audio using Whisper
 *
 * Template Variation Rendering:
 * - Each template variation has specific rendering logic
 * - before-after-1: Shows "BEFORE" and "AFTER" labels on respective b-roll clips
 * - testimonial-1: Minimizes talking head visibility (mostly b-roll)
 * - Others: Standard b-roll overlay flow
 */
export interface VideoConfig {
  /** Array of scenes in timeline order */
  scenes: Scene[];
  /** TikTok-style caption pages with word-level timing */
  captionPages: CaptionPage[];
  /** Styling for TikTok-style captions */
  tikTokCaptionStyle: TikTokCaptionStyle;
  /** Legacy captions (for backwards compatibility) */
  captions?: Caption[];
  /** Legacy caption styling (for backwards compatibility) */
  captionStyle?: CaptionStyle;
  /** Background music settings */
  music?: MusicConfig;
  /** Cinematic outro layout (appears over final frames) */
  outroLayout?: OutroLayoutConfig;
  /** Legacy full-screen outro (for backwards compatibility) */
  outro?: OutroConfig;
  /** Video orientation */
  orientation: VideoOrientation;
  /** Frames per second */
  fps: number;
  /** Total duration in frames (calculated from scenes + outro) */
  durationInFrames: number;
  /** Template variation ID for variation-specific rendering logic */
  variationId?: TemplateVariationId;
  /** AI-generated narration audio (used when narrationType is 'ai_voiceover') */
  narrationAudio?: {
    url: string;
    volume?: number;
  };
  /** Text interstitial overlays (e.g., "CLIENT RESULTS COMING NOW") */
  textInterstitials?: TextInterstitial[];
  /** Full-screen reveal overlays (e.g., cinematic after photo with Ken Burns) */
  fullScreenReveals?: FullScreenReveal[];
  /** Picture-in-Picture overlays (e.g., before/after photo thumbnails) */
  pipOverlays?: PipOverlay[];
  /** Timed text frames for text-only narration mode (no voice, just text on screen) */
  textFrames?: TextFrame[];
  /** Offer card overlay for promotion videos */
  offerCard?: OfferCard;
  /** Educational video config - progressive stacking layout with beat-synced entrances */
  educationalConfig?: EducationalConfig;
  /** Organic template: typewriter headline + cursive caption (caption-tease-1) */
  captionTease?: CaptionTeaseConfig;
  /** Organic template: word-by-word fade-in benefit statements (fade-benefits-1) */
  fadeBenefits?: FadeBenefitsConfig;
  /** Organic template: single aesthetic serif line (aesthetic-line-1) */
  aestheticLine?: AestheticLineConfig;
  /** Organic template: numbered list with title (numbered-list-1) */
  numberedList?: NumberedListConfig;
  /** Organic template: INS/OUTS sectioned list (ins-outs-1) */
  insOuts?: InsOutsConfig;
  /** Organic template: top question + bottom CTA, inverted stroke (question-cta-1) */
  questionCta?: QuestionCtaConfig;
  /** Organic template: per-clip synced service improvements (improves-1) */
  improves?: ImprovesConfig;
  /** Organic template: numbered timed steps, one per clip (step-timer-1) */
  stepTimer?: StepTimerConfig;
  /** Organic template: "Day 1 → Day 30" timestamp + caption (time-progress-1) */
  timeProgress?: TimeProgressConfig;
  /** Organic template: A/B comment-vote poll (poll-1) */
  poll?: PollConfig;
  /** Organic template: myth → fact debunk (myth-fact-1) */
  mythFact?: MythFactConfig;
  /** Organic template: X vs Y comparison (versus-1) */
  versus?: VersusConfig;
  /** Organic template: price transparency receipt (price-reveal-1) */
  priceReveal?: PriceRevealConfig;
  /** Organic template: pinned client question (client-question-1) */
  clientQuestion?: ClientQuestionConfig;
  /** Organic template: come-with-me mini-vlog (come-with-me-1) */
  comeWithMe?: ComeWithMeConfig;
}

// ============================================================================
// Zod Schemas for runtime validation
// ============================================================================

export const sceneSchema = z.object({
  id: z.string(),
  clipUrl: z.string().url(),
  type: z.enum(['talking-head', 'b-roll']),
  trimStart: z.number().min(0),
  trimEnd: z.number().min(0),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  transition: z
    .enum(['none', 'fade', 'slide-left', 'slide-right', 'wipe'])
    .optional(),
  bRollType: z.enum(['before', 'after', 'procedure']).optional(),
  mediaType: z.enum(['video', 'image']).optional(),
});

export const captionWordSchema = z.object({
  text: z.string(),
  startMs: z.number().min(0),
  endMs: z.number().min(0),
});

export const captionPageSchema = z.object({
  id: z.string(),
  words: z.array(captionWordSchema),
  startFrame: z.number().min(0),
  endFrame: z.number().min(0),
});

export const captionSchema = z.object({
  id: z.string(),
  text: z.string(),
  startFrame: z.number().min(0),
  endFrame: z.number().min(0),
});

export const tikTokCaptionStyleSchema = z.object({
  position: z.enum(['top', 'center', 'bottom']),
  fontFamily: z.string(),
  fontSize: z.number().min(8).max(200),
  color: z.string(),
  highlightColor: z.string(),
  backgroundColor: z.string(),
  showBackground: z.boolean(),
  strokeWidth: z.number().min(0).max(50),
  strokeColor: z.string(),
});

export const captionStyleSchema = z.object({
  position: z.enum(['top', 'center', 'bottom']),
  fontFamily: z.string(),
  fontSize: z.number().min(8).max(200),
  color: z.string(),
  backgroundColor: z.string(),
  showBackground: z.boolean(),
});

export const musicConfigSchema = z.object({
  trackId: z.string(),
  url: z.string().url(),
  volume: z.number().min(0).max(1),
});

export const outroLayoutConfigSchema = z.object({
  layout: z.enum(['offer', 'location', 'tagline']),
  logoUrl: z.string().url().optional(),
  businessName: z.string(),
  tagline: z.string().optional(),
  primaryColor: z.string(),
  secondaryColor: z.string(),
  backgroundColor: z.string().optional(),
  address: z.string().optional(),
  ctaText: z.string().optional(),
  offerMainText: z.string().optional(),
  offerSubtext: z.string().optional(),
  durationInFrames: z.number().min(1),
});

export const outroConfigSchema = z.object({
  ctaText: z.string(),
  backgroundColor: z.string(),
  textColor: z.string(),
  logoUrl: z.string().url().optional(),
  durationInFrames: z.number().min(1),
});

export const templateVariationIdSchema = z.enum([
  'authority-1',
  'before-after-1',
  'educational-1',
  'educational-2',
  'educational-3',
  'offer-square-1',
  'testimonial-1',
  'testimonial-2',
  'testimonial-3',
  'caption-tease-1',
  'ins-outs-1',
  'question-cta-1',
  'improves-1',
  'fade-benefits-1',
  'aesthetic-line-1',
  'numbered-list-1',
  'highlight-caption-1',
  'curiosity-hook-1',
  'step-timer-1',
  'time-progress-1',
  'poll-1',
  'myth-fact-1',
  'versus-1',
  'price-reveal-1',
  'client-question-1',
  'come-with-me-1',
]);

export const textFrameStyleSchema = z.enum([
  'default',
  'question',
  'answer',
  'disclaimer',
  'cta',
]);

export const textFrameSchema = z.object({
  id: z.string(),
  text: z.string(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  style: textFrameStyleSchema.optional(),
});

export const offerCardSchema = z.object({
  serviceName: z.string(),
  serviceDescription: z.string().optional(),
  headline: z.string().optional(),
  originalPriceCents: z.number().min(0).optional(),
  offerPriceCents: z.number().min(0).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  bulletPoints: z.array(z.string()).max(4).optional(),
  ctaText: z.string(),
  urgencyText: z.string().optional(),
  audienceText: z.string().optional(),
  logoUrl: z.string().url().optional(),
  businessName: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  currencyCode: z.string().optional(),
});

export const educationalConfigSchema = z.object({
  questionText: z.string(),
  items: z.array(z.string()),
  ctaText: z.string(),
  primaryColor: z.string(),
  bpm: z.number().min(30).max(300).optional(),
  beatsPerItem: z.number().min(1).max(16).optional(),
});

export const captionTeaseConfigSchema = z.object({
  headline: z.string().min(1),
  emphasis: z.string().optional(),
  emoji: z.string().optional(),
  caption: z.string().min(1),
  charsPerSecond: z.number().min(4).max(120).optional(),
});

export const fadeBenefitsConfigSchema = z.object({
  lines: z.array(z.string().min(1)).min(1).max(8),
  secondsPerLine: z.number().min(1).max(8).optional(),
});

export const aestheticLineConfigSchema = z.object({
  text: z.string().min(1),
});

export const numberedListConfigSchema = z.object({
  title: z.string().min(1),
  items: z.array(z.string().min(1)).min(2).max(8),
  primaryColor: z.string().optional(),
});

export const insOutsConfigSchema = z.object({
  title: z.string().min(1),
  insLabel: z.string().optional(),
  insItems: z.array(z.string().min(1)).min(1).max(12),
  outsLabel: z.string().optional(),
  outsItems: z.array(z.string().min(1)).min(1).max(12),
  primaryColor: z.string().optional(),
});

export const questionCtaConfigSchema = z.object({
  question: z.string().min(1),
  ctaText: z.string().min(1),
  primaryColor: z.string().optional(),
});

export const improvesConfigSchema = z.object({
  serviceName: z.string().min(1),
  improvesLabel: z.string().optional(),
  items: z.array(z.string().min(1)).min(1).max(8),
  ctaText: z.string().min(1),
  primaryColor: z.string().optional(),
});

export const stepTimerConfigSchema = z.object({
  title: z.string().min(1),
  steps: z
    .array(
      z.object({
        label: z.string().min(1),
        duration: z.string().min(1),
      })
    )
    .min(1)
    .max(6),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
});

export const timeProgressConfigSchema = z.object({
  startLabel: z.string().min(1),
  endLabel: z.string().min(1),
  caption: z.string().min(1),
  primaryColor: z.string().optional(),
  businessName: z.string().optional(),
});

export const mythFactConfigSchema = z.object({
  seriesTitle: z.string().optional(),
  pairs: z
    .array(z.object({ myth: z.string().min(1), fact: z.string().min(1) }))
    .min(1)
    .max(3),
  ctaText: z.string().optional(),
});

export const versusConfigSchema = z.object({
  treatmentA: z.string().min(1),
  treatmentB: z.string().min(1),
  rounds: z
    .array(
      z.object({
        label: z.string().min(1),
        aValue: z.string().min(1),
        bValue: z.string().min(1),
      })
    )
    .min(2)
    .max(4),
  verdict: z.string().min(1),
  primaryColor: z.string().optional(),
});

export const priceRevealConfigSchema = z.object({
  hook: z.string().min(1),
  items: z
    .array(z.object({ name: z.string().min(1), price: z.string().min(1) }))
    .min(2)
    .max(5),
  totalPrice: z.string().min(1),
  valueLine: z.string().optional(),
  primaryColor: z.string().optional(),
});

export const clientQuestionConfigSchema = z.object({
  question: z.string().min(1),
  asker: z.string().min(1),
  answers: z.array(z.string().min(1)).min(2).max(5),
  ctaText: z.string().optional(),
});

export const comeWithMeConfigSchema = z.object({
  title: z.string().min(1),
  seriesChip: z.string().optional(),
  steps: z.array(z.string().min(1)).min(3).max(7),
  closingCta: z.string().min(1),
});

export const pollConfigSchema = z.object({
  question: z.string().min(1),
  likeLabel: z.string().min(1),
  commentLabel: z.string().min(1),
  shareLabel: z.string().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
});

export const textInterstitialSchema = z.object({
  text: z.string(),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  verticalPosition: z.number().min(0).max(1).optional(),
  fontSize: z.number().min(8).max(300).optional(),
  soundEffectUrl: z.string().url().optional(),
});

export const fullScreenRevealSchema = z.object({
  src: z.string().url(),
  mediaType: z.enum(['image', 'video']),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  trimStart: z.number().min(0).optional(),
  zoomRange: z.tuple([z.number(), z.number()]).optional(),
  transition: z
    .enum(['none', 'fade', 'slide-left', 'slide-right', 'wipe'])
    .optional(),
  transitionDurationFrames: z.number().min(0).optional(),
  label: z.string().optional(),
  labelPosition: z
    .enum(['top-left', 'top-right', 'bottom-left', 'bottom-right'])
    .optional(),
  soundEffectUrl: z.string().url().optional(),
  soundEffectVolume: z.number().min(0).max(1).optional(),
});

export const pipOverlaySchema = z.object({
  imageUrl: z.string().url(),
  label: z.string().optional(),
  position: z.enum(['top-left', 'top-right', 'bottom-left', 'bottom-right']),
  startFrame: z.number().min(0),
  durationInFrames: z.number().min(1),
  sizePercent: z.number().min(5).max(50).optional(),
  soundEffectUrl: z.string().url().optional(),
});

export const videoConfigSchema = z.object({
  scenes: z.array(sceneSchema),
  captionPages: z.array(captionPageSchema),
  tikTokCaptionStyle: tikTokCaptionStyleSchema,
  captions: z.array(captionSchema).optional(),
  captionStyle: captionStyleSchema.optional(),
  music: musicConfigSchema.optional(),
  outroLayout: outroLayoutConfigSchema.optional(),
  outro: outroConfigSchema.optional(),
  orientation: z.enum(['portrait', 'landscape', 'square']),
  fps: z.number().min(1).max(120),
  durationInFrames: z.number().min(1),
  variationId: templateVariationIdSchema.optional(),
  narrationAudio: z
    .object({
      url: z.string().url(),
      volume: z.number().min(0).max(1).optional(),
    })
    .optional(),
  textInterstitials: z.array(textInterstitialSchema).optional(),
  fullScreenReveals: z.array(fullScreenRevealSchema).optional(),
  pipOverlays: z.array(pipOverlaySchema).optional(),
  textFrames: z.array(textFrameSchema).optional(),
  offerCard: offerCardSchema.optional(),
  educationalConfig: educationalConfigSchema.optional(),
  captionTease: captionTeaseConfigSchema.optional(),
  fadeBenefits: fadeBenefitsConfigSchema.optional(),
  aestheticLine: aestheticLineConfigSchema.optional(),
  numberedList: numberedListConfigSchema.optional(),
  insOuts: insOutsConfigSchema.optional(),
  questionCta: questionCtaConfigSchema.optional(),
  improves: improvesConfigSchema.optional(),
  stepTimer: stepTimerConfigSchema.optional(),
  timeProgress: timeProgressConfigSchema.optional(),
  poll: pollConfigSchema.optional(),
  mythFact: mythFactConfigSchema.optional(),
  versus: versusConfigSchema.optional(),
  priceReveal: priceRevealConfigSchema.optional(),
  clientQuestion: clientQuestionConfigSchema.optional(),
  comeWithMe: comeWithMeConfigSchema.optional(),
});

// ============================================================================
// Default values
// ============================================================================

export const DEFAULT_TIKTOK_CAPTION_STYLE: TikTokCaptionStyle = {
  position: 'center',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 64,
  color: '#FFFFFF',
  highlightColor: '#FFFFFF', // Default to white
  backgroundColor: 'transparent',
  showBackground: false,
  strokeWidth: 20,
  strokeColor: '#000000',
};

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  position: 'bottom',
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 48,
  color: '#FFFFFF',
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  showBackground: true,
};

export const DEFAULT_FPS = 30;

export const PORTRAIT_DIMENSIONS = {
  width: 1080,
  height: 1920,
};

export const LANDSCAPE_DIMENSIONS = {
  width: 1920,
  height: 1080,
};

export const SQUARE_DIMENSIONS = {
  width: 1080,
  height: 1080,
};

/**
 * Get dimensions based on orientation
 */
export function getDimensions(orientation: VideoOrientation) {
  if (orientation === 'portrait') return PORTRAIT_DIMENSIONS;
  if (orientation === 'square') return SQUARE_DIMENSIONS;
  return LANDSCAPE_DIMENSIONS;
}

// ============================================================================
// Caption page generation utilities
// ============================================================================

/**
 * Time interval for switching caption pages (in milliseconds)
 * TikTok typically shows 3-5 words at a time for readability
 */
export const CAPTION_PAGE_DURATION_MS = 1200;

/**
 * Maximum words per caption page
 */
export const MAX_WORDS_PER_PAGE = 5;

/**
 * Convert milliseconds to frames
 */
export function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/**
 * Convert frames to milliseconds
 */
export function framesToMs(frames: number, fps: number): number {
  return (frames / fps) * 1000;
}
