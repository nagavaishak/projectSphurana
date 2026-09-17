/**
 * Content Idea Template and Variation Definitions
 *
 * This is the backend source of truth for template variations.
 * The frontend has its own copy with additional UI-specific fields (icons, preview videos).
 *
 * When a video is created, a variation is randomly selected from the template.
 * Each template has 3 minor variations with different scripts, clip guidance labels,
 * and instructions — but the same overall concept and number of slots.
 */

import { SHARED_MUSIC_TRACKS } from '@borradh-workspace/video-templates/music-registry';

export { SHARED_MUSIC_TRACKS };

export interface TemplateClipGuidance {
  order: number;
  label: string;
  description: string;
  /** Default tag filter for this slot's media selection step */
  filterTag?: string;
}

/**
 * Rendering configuration for template variations
 * Controls how b-roll and talking head are rendered
 */
export interface TemplateRenderingConfig {
  /** Whether to show labels on b-roll clips (e.g., "BEFORE", "AFTER") */
  showLabels?: boolean;
  /** B-roll types that should have labels rendered */
  labeledBRollTypes?: ('before' | 'after' | 'procedure')[];
  /**
   * Talking head visibility percentage (0-100)
   * Lower values mean more b-roll coverage
   * Default: 100 (standard behavior)
   * For testimonials: 40 (alternating talking head and b-roll)
   */
  talkingHeadVisibilityPercent?: number;
}

export interface TemplateVariation {
  id: string; // e.g., "before-after-1"
  variationName: string; // e.g., "Classic Transformation"
  description: string;
  scriptTemplate: string;
  clipGuidance: TemplateClipGuidance[];
  recommendedClipCount: number;
  backgroundFootageHint: string;
  /** Default narration mode for this variation. Defaults to 'recorded' if not set. */
  narrationMode?: 'recorded' | 'ai_voiceover' | 'text_only';
  /** Rendering configuration for Remotion composition */
  renderingConfig?: TemplateRenderingConfig;
  /**
   * Hard cap on b-roll clips for this variation. Defensive guard against
   * Remotion Lambda OOM with too many concurrent clip decodes. Defaults to
   * DEFAULT_MAX_BROLL_CLIPS when not set.
   */
  maxBRollClips?: number;
}

/**
 * Default hard cap on b-roll clips per video. Protects Remotion Lambda
 * renders from OOM (each chunk decodes every clip whose range overlaps it).
 */
export const DEFAULT_MAX_BROLL_CLIPS = 4;

export interface TemplateMusicTrack {
  id: string;
  name: string;
  /** Path relative to CDN root, e.g. "/public/audio/tea-pop.mp3" */
  path: string;
  duration: number; // seconds
  artist?: string;
  /** Beats per minute for beat-synced b-roll transitions */
  bpm?: number;
}

export interface ContentIdeaTemplate {
  id: string; // Category ID: "before-after"
  title: string;
  description: string;
  variations: TemplateVariation[];
  musicTracks?: TemplateMusicTrack[];
  /** How many beats between b-roll edit points (e.g., 2 = cut every 2 beats) */
  beatsPerEdit?: number;
  /** Whether this template supports AI voiceover narration (default: true) */
  supportsAiVoiceover?: boolean;
  /**
   * Which usage stream this template feeds. Defaults to 'ad' — existing
   * ad-suitable templates (before/after, talking head). Templates intended
   * for organic social posts (text-on-b-roll, no narration) are tagged
   * 'organic' so the monthly bulk batch flow can filter them.
   */
  usageType?: 'ad' | 'organic';
}

/**
 * All content idea templates with their variations.
 *
 * IMPORTANT: These definitions MUST stay in sync with the frontend copy at
 * apps/web/src/app/(protected)/dashboard/content/ideas/components/content-idea-templates.tsx
 * The frontend adds UI-specific fields (icons, preview URLs, instructions) but the
 * variation IDs, scriptTemplates, clipGuidance, and narrationMode must match.
 */
export const CONTENT_IDEA_TEMPLATES: ContentIdeaTemplate[] = [
  // ─── Authority ───────────────────────────────────────────────────────
  {
    id: 'authority',
    title: 'Authority',
    description:
      'Position yourself as an expert by sharing insights, credentials, or industry knowledge.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    variations: [
      {
        id: 'authority-1',
        variationName: 'Clinic Owner On Camera',
        description:
          'You speak directly to camera about your service. Confident, direct, no fluff.',
        narrationMode: 'recorded',
        scriptTemplate:
          "Hi, I'm [NAME] from [CLINIC NAME].\n\nOne of the most common reasons people come to us for [SERVICE NAME] is because they want to see [VISIBLE IMPROVEMENT / OUTCOME] in [AREA].\n\nTypically, clients are looking for [RESULT TYPE – e.g. reduction, tightening, smoothing, improvement], while still keeping results natural and realistic.\n\nThe way [SERVICE NAME] works is [HIGH-LEVEL PROCESS – 1 sentence], and every client starts with a consultation so we can assess suitability and explain what kind of results are realistic for them.\n\nWhile results vary from person to person, most people want to know what's possible and what timeframe to expect, which is exactly what we cover during the consultation.\n\nIf you're considering [SERVICE NAME], the first step is to book a consultation and see if it's right for you.",
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Footage of the treatment being performed',
            filterTag: 'procedure',
          },
          {
            order: 2,
            label: 'Clinic Environment',
            description: 'Clean clinic shots, consultation room, equipment',
            filterTag: 'environment',
          },
          {
            order: 3,
            label: 'Before & After',
            description: 'Optional before and after clips for this service',
            filterTag: 'before-after',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload procedure clips, clinic environment shots, and optionally before & after footage. These will cut in during your talking head.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
        maxBRollClips: 4,
      },
      {
        id: 'authority-2',
        variationName: 'AI Voiceover — Credibility',
        description:
          'Same authority message without camera pressure. AI voice over clinic and procedure footage.',
        narrationMode: 'ai_voiceover',
        scriptTemplate:
          'At [CLINIC NAME], [SERVICE NAME] is used to help improve [PAIN POINT 1], [PAIN POINT 2], and [PAIN POINT 3]. By up to [X] percentage.\n\nThe clinic has helped [NUMBER]+ clients across [LOCATION], with a strong focus on consultation and realistic outcomes.\n\nBook a consultation to find out if this treatment is right for you.',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Footage of the treatment being performed',
            filterTag: 'procedure',
          },
          {
            order: 2,
            label: 'Clinic Environment',
            description: 'Clean clinic shots, consultation room',
            filterTag: 'environment',
          },
          {
            order: 3,
            label: 'Before & After',
            description: 'Optional before and after clips',
            filterTag: 'before-after',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload procedure footage and clinic environment clips. Optional before & after. These play full-screen while the AI voiceover narrates.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
        maxBRollClips: 4,
      },
      {
        id: 'authority-3',
        variationName: 'AI Voiceover — Proof/Standards',
        description:
          'Ultra-safe, trust-heavy version. Focuses on consultation-first approach and professional standards.',
        narrationMode: 'ai_voiceover',
        scriptTemplate:
          '[SERVICE NAME] at [CLINIC NAME] is delivered using a consultation-first approach, with every client assessed for suitability.\n\nThe clinic has worked with [NUMBER]+ clients across [LOCATION], focusing on safe, professional treatment standards. And helping clients receive up to [RESULT].\n\nBook a consultation to learn more.',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Professional footage of the treatment',
            filterTag: 'procedure',
          },
          {
            order: 2,
            label: 'Clinic Environment',
            description: 'Consultation room, equipment, professional setting',
            filterTag: 'environment',
          },
          {
            order: 3,
            label: 'Before & After',
            description: 'Optional before and after clips',
            filterTag: 'before-after',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload professional clinic footage. Procedure clips, consultation room, equipment. Optional before & after.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
        maxBRollClips: 4,
      },
    ],
  },

  // ─── Before & After ──────────────────────────────────────────────────
  {
    id: 'before-after',
    title: 'Before and After',
    description:
      'Show clear, visual transformations that highlight real results and set expectations.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    variations: [
      {
        id: 'before-after-1',
        variationName: 'Classic Transformation',
        description: 'Show a dramatic before, process, and after sequence',
        narrationMode: 'text_only',
        scriptTemplate:
          "Check out this transformation. Here's where we started... and here's the result. Want the same? Link below!",
        clipGuidance: [
          {
            order: 1,
            label: 'Before',
            description: "Client's appearance before the treatment",
            filterTag: 'before',
          },
          {
            order: 2,
            label: 'Procedure',
            description: 'Service or treatment being performed',
            filterTag: 'procedure',
          },
          {
            order: 3,
            label: 'After',
            description: 'Final results and transformation',
            filterTag: 'after',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload clips in order: before footage, procedure clips, then after results. We recommend 3-5 clips.',
        renderingConfig: {
          showLabels: true,
          labeledBRollTypes: ['before', 'after'],
          talkingHeadVisibilityPercent: 100,
        },
      },
      {
        id: 'before-after-2',
        variationName: 'The Reveal',
        description:
          'Build suspense before showing the dramatic transformation',
        narrationMode: 'text_only',
        scriptTemplate:
          "You won't believe this difference... Here's where we started. And here's the reveal! Link in bio for results like this.",
        clipGuidance: [
          {
            order: 1,
            label: 'Before',
            description: 'Starting point — the original state',
            filterTag: 'before',
          },
          {
            order: 2,
            label: 'The Process',
            description: 'Key moments during the transformation',
            filterTag: 'procedure',
          },
          {
            order: 3,
            label: 'After',
            description: 'The dramatic final reveal',
            filterTag: 'after',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload clips in order: starting footage, process highlights, then the big reveal.',
        renderingConfig: {
          showLabels: true,
          labeledBRollTypes: ['before', 'after'],
          talkingHeadVisibilityPercent: 100,
        },
      },
      {
        id: 'before-after-3',
        variationName: 'Process & Results',
        description:
          'Walk through the transformation step by step with commentary',
        narrationMode: 'text_only',
        scriptTemplate:
          "Let me walk you through this one. Here's where we started... here's what we did... and the finished result! Follow for more.",
        clipGuidance: [
          {
            order: 1,
            label: 'Before',
            description: 'The initial state before your service',
            filterTag: 'before',
          },
          {
            order: 2,
            label: 'Step by Step',
            description: 'Walk through the key steps of the process',
            filterTag: 'procedure',
          },
          {
            order: 3,
            label: 'After',
            description: 'The completed transformation',
            filterTag: 'after',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload clips: starting state, multiple process steps, then the final result.',
        renderingConfig: {
          showLabels: true,
          labeledBRollTypes: ['before', 'after'],
          talkingHeadVisibilityPercent: 100,
        },
      },
    ],
  },

  // ─── Educational ─────────────────────────────────────────────────────
  {
    id: 'educational',
    title: 'Educational',
    description:
      'Educate your audience about your services with text-on-screen or AI voiceover formats.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    variations: [
      {
        id: 'educational-1',
        variationName: 'Q&A / Association',
        narrationMode: 'text_only',
        description:
          'Text on screen only — associate your service with a pain point and result (8-10s, no voice)',
        scriptTemplate:
          'Struggling with [PAIN POINT]?\n[SERVICE NAME] → helps improve [RESULT / OUTCOME]\nResults vary • Consultation required\nDM to Learn More',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Footage of the service being performed or clinic b-roll',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload procedure footage or clinic b-roll. The text frames appear over the footage — no talking head needed.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
      },
      {
        id: 'educational-2',
        variationName: 'Common Doubts / Worries',
        narrationMode: 'text_only',
        description:
          'Text on screen only — address scepticism about your service with facts (10-12s, no voice)',
        scriptTemplate:
          'Is [SERVICE NAME] actually effective?\nHelps with [PAIN POINT / RESULT A]\nCan improve [PAIN POINT / RESULT B]\nOften used for [PAIN POINT / RESULT C]\nConsultation required • Results vary',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure / Clinic Footage',
            description:
              'Footage of the service being performed or clinic environment',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload procedure footage or clinic b-roll. Text frames appear on screen — no talking head needed.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
      },
      {
        id: 'educational-3',
        variationName: 'How It Works',
        narrationMode: 'text_only',
        description:
          'Text on screen only — explain how your service works with procedure footage (10-12s, no voice)',
        scriptTemplate:
          '[SERVICE NAME] is commonly used to help target [PAIN POINT 1] and [PAIN POINT 2].\nThe treatment works by [HIGH-LEVEL PROCESS]\nHelps support [RESULT TYPE] over time\nConsultation required • Results vary\nDM to Learn More',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Footage of the treatment being performed',
            filterTag: 'procedure',
          },
          {
            order: 2,
            label: 'Clinic Environment',
            description: 'Clinic interior, equipment, or consultation footage',
            filterTag: 'environment',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload procedure footage and clinic environment clips. Text frames appear on screen — no voice needed.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
      },
    ],
  },

  // ─── Offer ───────────────────────────────────────────────────────────
  {
    id: 'offer',
    title: 'Offer',
    description:
      'Promote a special deal, discount, or limited-time opportunity to drive action.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 2,
    supportsAiVoiceover: false,
    variations: [
      {
        id: 'offer-square-1',
        variationName: 'Square Offer',
        narrationMode: 'text_only',
        description:
          'Side-by-side 1080x1080 layout — procedure footage on the left, offer card on the right. Music-driven with fast cuts.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Treatment footage and clinic environment clips. Fast cuts synced to music beats.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload procedure footage — AI will cut clips to the beat. The left 3/5 of the square shows your footage, right 2/5 shows the offer card.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 100,
        },
        maxBRollClips: 4,
      },
    ],
  },

  // ─── Organic: Caption Tease ─────────────────────────────────────────
  {
    id: 'caption-tease',
    title: 'Caption Tease',
    description:
      'Centered serif headline with a cursive "Check the caption" hook. Both reveal with a typewriter animation over a procedure b-roll.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'caption-tease-1',
        variationName: 'Typewriter Hook',
        narrationMode: 'text_only',
        description:
          'Headline (with a bolded emphasis word) + cursive caption. Procedure b-roll cuts 2–3 times across ~8 seconds underneath.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Close-up procedure clips that read clearly behind centered text.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload 2–3 procedure clips. The headline reveals first, then the cursive caption hook drops in.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 3,
      },
    ],
  },

  // ─── Organic: Fade-In Benefits ──────────────────────────────────────
  {
    id: 'fade-benefits',
    title: 'Fade-In Benefits',
    description:
      'Short benefit statements fade in word-by-word (centered serif, lower third) over a procedure b-roll. Calm, premium feel.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'fade-benefits-1',
        variationName: 'Word-by-Word Fade',
        narrationMode: 'text_only',
        description:
          'Each benefit statement reveals one word at a time with a soft fade, one statement at a time over the b-roll.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Calm, close-up procedure clips that read well behind centered serif text.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload 2–3 calm procedure clips. The benefit statements fade in over them, one at a time.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 3,
      },
    ],
  },

  // ─── Organic: Step + Timer ──────────────────────────────────────────
  {
    id: 'step-timer',
    title: 'Step + Timer',
    description:
      'A bold title, then numbered timed steps (each with its duration) revealing one per clip over a darkened procedure b-roll. Save-worthy routine content.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'step-timer-1',
        variationName: 'Timed Steps',
        narrationMode: 'text_only',
        description:
          'Title + a numbered list of timed steps, each "Step — duration", revealing one at a time over the b-roll.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Procedure or routine clips that read under a scrim.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload 3–4 clips (one per step). Each timed step appears over its clip.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 6,
      },
    ],
  },

  // ─── Organic: Poll / This-or-That ───────────────────────────────────
  {
    id: 'poll',
    title: 'Engagement Poll',
    description:
      'An A/B question voted with native actions — like for one option, comment for the other (share for an optional third). Results show on the post itself.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'poll-1',
        variationName: 'Like / Comment Vote',
        narrationMode: 'text_only',
        description:
          'Question pinned top, two numbered option cards centred, vote CTA at the bottom, over calm b-roll.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Procedure or ambience clips that read under a scrim.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload 2-3 calm clips — the poll card sits on top the whole video.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 4,
      },
    ],
  },

  // ─── Organic: Myth → Fact ───────────────────────────────────────────
  {
    id: 'myth-fact',
    title: 'Myth → Fact',
    description:
      'A confidently wrong belief flips to the correction — red MYTH pill to green FACT pill on cream cards. Authority-building debunk content.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'myth-fact-1',
        variationName: 'Debunk Card',
        narrationMode: 'text_only',
        description:
          'Myth/fact pairs on cream statement cards with state pills.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Procedure or ambience clips that read under a scrim.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload 3-4 calm clips — the cards carry the story.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 5,
      },
    ],
  },

  // ─── Organic: X vs Y ────────────────────────────────────────────────
  {
    id: 'versus',
    title: 'X vs Y',
    description:
      'The exact decision viewers are stuck on (Botox vs Filler) compared attribute by attribute, closing on an it-depends verdict.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'versus-1',
        variationName: 'Split Verdict',
        narrationMode: 'text_only',
        description: 'Stacked name cards, attribute rounds, verdict card.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Treatment clips for both options if available.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 4,
        backgroundFootageHint:
          'Upload 4-6 clips; each comparison round gets its own look.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 6,
      },
    ],
  },

  // ─── Organic: Price Reveal ──────────────────────────────────────────
  {
    id: 'price-reveal',
    title: 'Price Reveal',
    description:
      'The unGoogleable price question answered as a building receipt, with the total withheld to the final beat. Transparency = trust.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'price-reveal-1',
        variationName: 'Receipt Build',
        narrationMode: 'text_only',
        description:
          'Hook, line items stacking receipt-style, big total stamp.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Treatment/clinic clips behind the receipt.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 4,
        backgroundFootageHint: 'Upload 4-5 clips — one per receipt beat.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 6,
      },
    ],
  },

  // ─── Organic: Client Question ───────────────────────────────────────
  {
    id: 'client-question',
    title: 'Client Question',
    description:
      'A real-looking client question pinned in a reply bubble while the answer plays out underneath — the eavesdrop format.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'client-question-1',
        variationName: 'Reply Bubble',
        narrationMode: 'text_only',
        description: 'Pinned question sticker + lower-third answer beats.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Clips that visually answer the question.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 4,
        backgroundFootageHint:
          'Upload 3-5 clips — the bubble persists over all of them.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 6,
      },
    ],
  },

  // ─── Organic: Come With Me ──────────────────────────────────────────
  {
    id: 'come-with-me',
    title: 'Come With Me',
    description:
      'The invitation mini-vlog: script title, lowercase diary captions, calm pace. The strongest booking-intent format — it de-scaries the visit.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'come-with-me-1',
        variationName: 'Mini Vlog',
        narrationMode: 'text_only',
        description: 'Script title beat, step captions per clip, closing CTA.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Experience Footage',
            description:
              'The visit start-to-finish: arrival, treatment, results.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 6,
        backgroundFootageHint:
          'Upload 5-7 clips walking through the whole visit.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 8,
      },
    ],
  },

  // ─── Organic: Time-lapse Progress ───────────────────────────────────
  {
    id: 'time-progress',
    title: 'Time-lapse Progress',
    description:
      'A big timestamp progression ("Day 1 → Day 30") held over before→after footage with a short caption. Lets people watch results happen.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'time-progress-1',
        variationName: 'Before → After',
        narrationMode: 'text_only',
        description:
          'A timestamp progression as the hero, a short caption below, over footage that changes from before to after.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Before & After',
            description:
              'A before clip and an after clip so the change is visible.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload a before clip and an after clip. The timestamp holds while the footage changes.',
        renderingConfig: { showLabels: false, talkingHeadVisibilityPercent: 0 },
        maxBRollClips: 4,
      },
    ],
  },

  // ─── Organic: Curiosity Hook ────────────────────────────────────────
  {
    id: 'curiosity-hook',
    title: 'Curiosity Hook',
    description:
      'A bold, surprising claim pinned at the top with a "watch till the end" nudge at the bottom, over a procedure b-roll. A curiosity gap that drives full watches.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'curiosity-hook-1',
        variationName: 'Bold Claim',
        narrationMode: 'text_only',
        description:
          'A bold curiosity-gap claim at the top, a "watch till the end" nudge at the bottom, black-on-white-stroke for contrast over the b-roll.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Procedure clips that work behind top + bottom text.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload 2–3 procedure clips. Use a bold claim up top; the payoff plays out across the video.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 4,
      },
    ],
  },

  // ─── Organic: Highlight Caption ─────────────────────────────────────
  {
    id: 'highlight-caption',
    title: 'Highlight Caption',
    description:
      'Short lines reveal one at a time as white text on solid brand-colour highlight blocks over a procedure b-roll. The dominant reel caption format.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'highlight-caption-1',
        variationName: 'Highlight Blocks',
        narrationMode: 'text_only',
        description:
          'A hook line, then 3-5 short statements, each shown on its own solid brand-colour highlight block, one at a time over the b-roll.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Close-up procedure clips that read clearly behind centered highlight blocks.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 3,
        backgroundFootageHint:
          'Upload 2–3 procedure clips. Each caption line appears on a solid brand-colour block, one at a time.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 4,
      },
    ],
  },

  // ─── Organic: Aesthetic Line ────────────────────────────────────────
  {
    id: 'aesthetic-line',
    title: 'Aesthetic Line',
    description:
      'A single understated serif line (lower third) that fades in gently over calm b-roll. Quiet, relatable, scroll-stopping.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'aesthetic-line-1',
        variationName: 'Single Line',
        narrationMode: 'text_only',
        description:
          'One short, soft line that holds for the whole clip over calm footage.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Calm Footage',
            description: 'Slow, calm procedure or ambience clips.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload 1–2 calm clips. A single aesthetic line fades in over them.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 3,
      },
    ],
  },

  // ─── Organic: Numbered List ─────────────────────────────────────────
  {
    id: 'numbered-list',
    title: 'Numbered List',
    description:
      'A bold uppercase title and a numbered list (with badges) over darkened b-roll. Save-worthy tips.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'numbered-list-1',
        variationName: 'Tips List',
        narrationMode: 'text_only',
        description:
          'Title + a numbered list of short tips, items revealing one-by-one over a darkened b-roll.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Procedure or clinic clips that read under a dark scrim.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload 2–3 clips. The title and numbered tips appear over a darkened version of your footage.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 3,
      },
    ],
  },

  // ─── Organic: INS + OUTS ────────────────────────────────────────────
  {
    id: 'ins-outs',
    title: 'INS + OUTS',
    description:
      'Title at top, then two sectioned lists (INS / OUTS) of single-line items over a darkened b-roll.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'ins-outs-1',
        variationName: 'Standard List',
        narrationMode: 'text_only',
        description:
          'Title at top, INS section, OUTS section. Items always render on one line — long copy auto-shrinks horizontally.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description:
              'Procedure or clinic-environment clips that read well behind a dark scrim.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload 2–3 procedure clips. A subtle dark overlay sits on top so the list is always legible.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 3,
      },
    ],
  },

  // ─── Organic: Question + Read Caption ───────────────────────────────
  {
    id: 'question-cta',
    title: 'Question + Read Caption',
    description:
      'A hooked question at the top of the frame and a "Read caption ⬇" CTA at the bottom. Black fill with white stroke for contrast over any footage.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'question-cta-1',
        variationName: 'Top Question + Bottom CTA',
        narrationMode: 'text_only',
        description:
          'Question at top, "Read caption ⬇" CTA at bottom. Procedure b-roll cuts 2–3 times underneath.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Procedure Footage',
            description: 'Procedure clips that work behind top + bottom text.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 2,
        backgroundFootageHint:
          'Upload 2–3 procedure clips. Use a tight hook question; the long-form story belongs in the caption.',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 3,
      },
    ],
  },

  // ─── Organic: Improves ──────────────────────────────────────────────
  {
    id: 'improves',
    title: 'Service Improves',
    description:
      'Opens on the service name, cuts through "IMPROVES: <item>" beats — one item per clip — and ends on a journey CTA.',
    musicTracks: SHARED_MUSIC_TRACKS,
    beatsPerEdit: 4,
    supportsAiVoiceover: false,
    usageType: 'organic',
    variations: [
      {
        id: 'improves-1',
        variationName: 'Improves List',
        narrationMode: 'text_only',
        description:
          'Service name → N benefit beats (one clip each) → closing CTA. Text changes on every cut.',
        scriptTemplate: '',
        clipGuidance: [
          {
            order: 1,
            label: 'Service Footage',
            description:
              'Tight, varied close-ups of the service in progress. One clip per beat.',
            filterTag: 'procedure',
          },
        ],
        recommendedClipCount: 5,
        backgroundFootageHint:
          'Upload one opening clip, one clip per "improves" item, and one closing CTA clip (5 total for 3 benefits).',
        renderingConfig: {
          showLabels: false,
          talkingHeadVisibilityPercent: 0,
        },
        maxBRollClips: 6,
      },
    ],
  },

  // ─── Testimonial (hidden for now) ───────────────────────────────────
  // {
  //   id: 'testimonial',
  //   title: 'Testimonial',
  //   description:
  //     'Share authentic customer experiences to build trust and social proof.',
  //   musicTracks: SHARED_MUSIC_TRACKS,
  //   beatsPerEdit: 6,
  //   supportsAiVoiceover: false,
  //   variations: [
  //     {
  //       id: 'testimonial-1',
  //       variationName: 'Results-First',
  //       narrationMode: 'recorded',
  //       description:
  //         'Lead with results, then let the patient tell their story. The strongest testimonial format.',
  //       scriptTemplate:
  //         "Hi guys, today I'm here with [PATIENT NAME].\n\n[PATIENT NAME] came to us for [PROBLEM], and after [TIMEFRAME], we've seen [RESULT A / B / C].\n\n[PATIENT NAME], do you want to tell people a bit about what brought you in?\n\n[Client responds — talks about their problem and why they booked]\n\nA lot of people worry about whether this treatment is uncomfortable — how did you find it?\n\n[Client responds]\n\nAnd were the results what you were expecting?\n\n[Client responds]\n\nAmazing. If you're considering [SERVICE NAME], the first step is always a consultation to see if it's right for you.",
  //       clipGuidance: [
  //         {
  //           order: 1,
  //           label: 'Procedure Footage',
  //           description:
  //             'Footage of this treatment being performed (any client)',
  //           filterTag: 'procedure',
  //         },
  //         {
  //           order: 2,
  //           label: 'Before & After',
  //           description: 'Optional before and after clips for this procedure',
  //           filterTag: 'before-after',
  //         },
  //       ],
  //       recommendedClipCount: 3,
  //       backgroundFootageHint:
  //         'Upload procedure footage and optionally before & after clips. These cut in during the talking head interview for visual variety.',
  //       renderingConfig: {
  //         showLabels: false,
  //         talkingHeadVisibilityPercent: 40,
  //       },
  //     },
  //     {
  //       id: 'testimonial-2',
  //       variationName: 'Doubt-Killer',
  //       narrationMode: 'recorded',
  //       description:
  //         'Address scepticism head-on. Patient shares their doubts, then confirms the results.',
  //       scriptTemplate:
  //         "I'm here with [PATIENT NAME], who came in unsure if [SERVICE NAME] would actually work for [PROBLEM].\n\nAfter [TIMEFRAME], we've seen [RESULT].\n\n[PATIENT NAME], what were your biggest doubts before starting?\n\n[Client responds — mentions fear or scepticism]\n\nWas it as bad as you thought it would be?\n\n[Client responds]\n\nHow happy are you with the results now?\n\n[Client responds]\n\nThat's exactly why we always recommend starting with a consultation.",
  //       clipGuidance: [
  //         {
  //           order: 1,
  //           label: 'Procedure Footage',
  //           description: 'Footage of the treatment being performed',
  //           filterTag: 'procedure',
  //         },
  //         {
  //           order: 2,
  //           label: 'Before & After',
  //           description: 'Optional before and after clips for this procedure',
  //           filterTag: 'before-after',
  //         },
  //       ],
  //       recommendedClipCount: 3,
  //       backgroundFootageHint:
  //         'Upload procedure footage and optionally before & after clips. These cut in during the interview.',
  //       renderingConfig: {
  //         showLabels: false,
  //         talkingHeadVisibilityPercent: 40,
  //       },
  //     },
  //     {
  //       id: 'testimonial-3',
  //       variationName: 'Impact-Led',
  //       narrationMode: 'recorded',
  //       description:
  //         'Focus on day-to-day impact. Patient shares how the treatment changed their life.',
  //       scriptTemplate:
  //         "Today I'm with [PATIENT NAME], who came to us for [PROBLEM].\n\nAfter [TIMEFRAME], we've achieved [RESULT].\n\n[PATIENT NAME], how has this actually impacted you day to day?\n\n[Client responds — mentions confidence, comfort, or convenience]\n\nIf someone is on the fence, what would you say to them?\n\n[Client responds]\n\nWas the process what you expected?\n\n[Client responds]\n\nIf that sounds like you, book a consultation and we'll walk you through it.",
  //       clipGuidance: [
  //         {
  //           order: 1,
  //           label: 'Procedure Footage',
  //           description: 'Footage of the treatment being performed',
  //           filterTag: 'procedure',
  //         },
  //         {
  //           order: 2,
  //           label: 'Before & After',
  //           description: 'Optional before and after clips for this procedure',
  //           filterTag: 'before-after',
  //         },
  //       ],
  //       recommendedClipCount: 3,
  //       backgroundFootageHint:
  //         'Upload procedure footage and optionally before & after clips. These cut in during the emotional interview.',
  //       renderingConfig: {
  //         showLabels: false,
  //         talkingHeadVisibilityPercent: 40,
  //       },
  //     },
  //   ],
  // },
];

/**
 * Templates that are RETIRED — kept in `CONTENT_IDEA_TEMPLATES` so existing
 * rows referencing them still resolve for playback/history, but never offered
 * for NEW generation.
 *
 * `before-after` is retired because we cannot produce an honest one. The
 * "before"/"after" tags it selects on are applied by the vision model
 * (`suggestedTags` in vision-analysis.service.ts), not by a human, and
 * `select-before-after-clips` pairs the first org-wide `before` with the first
 * different `after` — no client, no service scoping. A prod audit found 32
 * before + 32 after assets with ZERO `client_name` set, i.e. zero honestly
 * pairable subjects: every before/after we generated paired two unrelated
 * people. That is a false-advertising exposure, so the format is withdrawn.
 *
 * Retirement is enforced in the getters below, which are the only way the
 * generation paths resolve a template or variation.
 */
export const RETIRED_TEMPLATE_IDS: ReadonlySet<string> = new Set([
  'before-after',
  // 'versus' pits two of the org's own treatments against each other
  // ("hydrafacial or peel facial?"). Too niche to be relatable to a general
  // audience, and it invites a comparison a clinic has no reason to publish.
  // Paused rather than deleted — existing rows still resolve for playback.
  'versus',
]);

/** True when `templateId` is retired and must not be generated. */
export function isRetiredTemplate(templateId: string): boolean {
  return RETIRED_TEMPLATE_IDS.has(templateId);
}

/**
 * Get template by category ID (e.g., "authority").
 *
 * Returns `undefined` for retired templates so every generation path that
 * resolves a template — create-video, the batch dispatcher, Claire — declines
 * them without needing its own check.
 */
export function getTemplateById(id: string): ContentIdeaTemplate | undefined {
  if (isRetiredTemplate(id)) return undefined;
  return CONTENT_IDEA_TEMPLATES.find((template) => template.id === id);
}

/**
 * Every template still available for new content — the list UIs and pickers
 * should render this, never `CONTENT_IDEA_TEMPLATES` directly.
 */
export function getSelectableTemplates(): ContentIdeaTemplate[] {
  return CONTENT_IDEA_TEMPLATES.filter((t) => !isRetiredTemplate(t.id));
}

/**
 * Templates tagged `usageType: 'organic'` — the social-first formats the
 * monthly content batch seeds one of each of. Excludes ad-only templates
 * (authority, before-after, educational, offer) which default to
 * `usageType: 'ad'`.
 */
export function getOrganicTemplates(): ContentIdeaTemplate[] {
  return CONTENT_IDEA_TEMPLATES.filter((t) => t.usageType === 'organic');
}

/**
 * The organic templates that may be PLANNED into new content — the organic
 * subset minus anything retired.
 *
 * Distinct from {@link getOrganicTemplates}, which deliberately still returns
 * retired ids so the registry/tuple sync guard keeps checking what it was
 * written to check: that `ORGANIC_TEMPLATE_IDS` matches the registry. Pausing
 * a format is a selection decision, not a registry change — the id stays
 * registered so existing rows resolve for playback and idea-gen keeps its
 * enum entry.
 */
export function getPlannableOrganicTemplates(): ContentIdeaTemplate[] {
  return getOrganicTemplates().filter((t) => !isRetiredTemplate(t.id));
}

/**
 * The organic template IDs as a literal tuple — the SINGLE SOURCE OF TRUTH for
 * `organicTemplateIdSchema` (the idea-generator's input enum) and the
 * `TEMPLATE_FORMAT_HINTS` Record keyed by it.
 *
 * Adding an organic template to `CONTENT_IDEA_TEMPLATES` without adding its id
 * here trips the runtime guard below (and reds `template-definitions.test.ts`),
 * and a missing `TEMPLATE_FORMAT_HINTS` entry then fails the build because the
 * Record is keyed by this tuple. That closes the gap that let
 * fade-benefits / aesthetic-line / numbered-list ship in #438 without
 * idea-gen support — the planner requested ideas for them, input validation
 * rejected the ids, and the dispatcher silently dropped the slots (#444).
 */
export const ORGANIC_TEMPLATE_IDS = [
  'caption-tease',
  'fade-benefits',
  'aesthetic-line',
  'numbered-list',
  'ins-outs',
  'question-cta',
  'improves',
  'highlight-caption',
  'curiosity-hook',
  'step-timer',
  'time-progress',
  'poll',
  'myth-fact',
  'versus',
  'price-reveal',
  'client-question',
  'come-with-me',
] as const;

export type OrganicTemplateId = (typeof ORGANIC_TEMPLATE_IDS)[number];

/**
 * Fail-fast guard: `ORGANIC_TEMPLATE_IDS` must cover EXACTLY the
 * `usageType: 'organic'` subset of `CONTENT_IDEA_TEMPLATES`. Runs once at
 * module load — a divergence is a developer error (a template was added or
 * removed without updating the tuple), so we throw rather than silently plan
 * content for an id idea-gen can't handle.
 */
{
  const fromArray = new Set(getOrganicTemplates().map((t) => t.id));
  const fromTuple = new Set<string>(ORGANIC_TEMPLATE_IDS);
  const missing = [...fromArray].filter((id) => !fromTuple.has(id));
  const extra = [...fromTuple].filter((id) => !fromArray.has(id));
  if (missing.length > 0 || extra.length > 0) {
    const missingNote = missing.length
      ? ` — missing: ${missing.join(', ')}`
      : '';
    const extraNote = extra.length ? ` — unexpected: ${extra.join(', ')}` : '';
    throw new Error(
      `ORGANIC_TEMPLATE_IDS is out of sync with the organic subset of CONTENT_IDEA_TEMPLATES${missingNote}${extraNote}`
    );
  }
}

/**
 * Get a random variation for a template
 */
export function getRandomVariation(
  template: ContentIdeaTemplate
): TemplateVariation {
  const randomIndex = Math.floor(Math.random() * template.variations.length);
  return template.variations[randomIndex];
}

/**
 * Get variation by ID (e.g., "before-after-1")
 */
export function getVariationById(
  variationId: string
): { template: ContentIdeaTemplate; variation: TemplateVariation } | null {
  for (const template of CONTENT_IDEA_TEMPLATES) {
    // Retired templates never resolve for new generation.
    if (isRetiredTemplate(template.id)) continue;
    const variation = template.variations.find((v) => v.id === variationId);
    if (variation) {
      return { template, variation };
    }
  }
  return null;
}

/**
 * Select a random variation for a given template ID
 * Returns both the template and selected variation
 */
export function selectRandomVariationForTemplate(templateId: string): {
  template: ContentIdeaTemplate;
  variation: TemplateVariation;
} | null {
  const template = getTemplateById(templateId);
  if (!template || template.variations.length === 0) {
    return null;
  }
  const variation = getRandomVariation(template);
  return { template, variation };
}
