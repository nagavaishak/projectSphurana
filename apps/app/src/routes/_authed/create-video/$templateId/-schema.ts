import type { OrganizationBrandResponse } from '@/features/organization';
import { createVideoForm } from '@/features/videos/api/create-video';
import { defineForm } from '@/lib/form-contract/define-form';
import { outroStyleLabels } from '@borradh-workspace/api-client/types';
import { z } from 'zod';
import type { SlotConfig } from './data/-slot-config';

/**
 * Available caption fonts - matches Remotion configuration
 */
export const CAPTION_FONTS = [
  'inter',
  'montserrat',
  'roboto',
  'poppins',
  'bebas-neue',
  'playfair-display',
] as const;
export type CaptionFont = (typeof CAPTION_FONTS)[number];

/**
 * The zod shape behind a `defineForm` declaration, so the full wizard schema can
 * be composed from the SAME per-field schemas the steps and the form-contract
 * harness use — one declaration per field, not two.
 */
const specShape = <F extends Record<string, { schema: z.ZodTypeAny }>>(
  specs: F
): { [K in keyof F]: F[K]['schema'] } =>
  Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, spec.schema])
  ) as { [K in keyof F]: F[K]['schema'] };

/**
 * THE SERVICE STEP — and the whole of the user's input to `POST videos` from
 * this wizard.
 *
 * The draft is written the moment the user leaves this step (the script step
 * needs a video id for the mobile-record QR code), so `serviceId` + `offerId`
 * are the only two fields a user can put into the create body. They are
 * declared once, with the rest of the operation's fields, in
 * `@/features/videos/api/create-video` — the create-from-client wizard owns the
 * other slice of the same body.
 */
export const serviceStepSchema = z.object({
  serviceId: createVideoForm.specs.serviceId.schema,
  offerId: createVideoForm.specs.offerId.schema,
});

/**
 * Text frame for text-only narration mode (stored in form data)
 */
export interface TextFrameInput {
  id: string;
  text: string;
  durationSec: number;
  style?: 'default' | 'question' | 'answer' | 'disclaimer' | 'cta';
}

export const scriptStepSchema = z
  .object({
    scriptText: z.string().min(1, 'Script is required'),
    narrationType: z
      .enum(['recorded', 'ai_voiceover', 'text_only'])
      .default('recorded'),
    aiVoiceId: z.string().optional(),
    textFrames: z
      .array(
        z.object({
          id: z.string(),
          text: z.string().min(1),
          durationSec: z.number().min(0.5).max(10),
          style: z
            .enum(['default', 'question', 'answer', 'disclaimer', 'cta'])
            .optional(),
        })
      )
      .optional(),
  })
  .refine((data) => data.narrationType !== 'ai_voiceover' || !!data.aiVoiceId, {
    message: 'Please select a voice',
    path: ['aiVoiceId'],
  });

/**
 * Offer step schema for offer templates (pricing, CTA, bullet points)
 */
export const offerStepSchema = z.object({
  offerId: z.string().optional(),
  offerHeadline: z.string().min(1, 'Offer headline is required'),
  bulletPoints: z.array(z.string()).max(4).optional(),
  ctaText: z.string().optional(),
  urgencyText: z.string().optional(),
  audienceText: z.string().optional(),
});

export const talkingHeadStepSchema = z.object({
  talkingHeadUrl: z.string().optional(),
});

/**
 * Clip slots schema for slot-based video templates
 * - before: Single asset ID for before transformation (before-after template)
 * - after: Single asset ID for after transformation (before-after template)
 * - bRoll: Array of asset IDs for b-roll clips (fallback for unordered templates)
 * - templateSlots: Ordered slot map { "1": [assetId, ...], "2": [assetId, ...] }
 *   Each slot can hold multiple asset IDs (e.g. multiple before/after videos).
 *   Used by all known templates (authority, before-after, educational, offer, testimonial)
 */
export const clipSlotsSchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  bRoll: z.array(z.string()).default([]),
  templateSlots: z.record(z.string(), z.array(z.string())).default({}),
});

export type ClipSlots = z.infer<typeof clipSlotsSchema>;

export const captionReviewStepSchema = z.object({
  editedCaptionText: z.string().optional(),
});

/**
 * THE CUSTOMISATION STEP — the final step, and the one that submits.
 *
 * Its "Create Video" button is what fires `PUT videos/:id` with the whole
 * draft, so these fields are the form behind that write. Declared with
 * `defineForm` so the schema, the defaults, the labels the JSX renders and the
 * labels the harness locates by are all one declaration.
 *
 * `title` and `outroStyle` are here because they are in the schema AND in the
 * submitted body — and until this conversion NEITHER had a control on screen
 * (the outro-style picker was deleted wholesale in 06fcba15a; the title input
 * never existed in this wizard). Both are restored in `CustomiseStep`.
 */
export const videoCustomiseForm = defineForm({
  fields: {
    title: {
      schema: z.string().max(100).default(''),
      label: 'Video Title',
      control: 'text',
      default: '',
      sample: 'Lip filler explainer',
    },
    musicTrackId: {
      // Picked in the music dialog — the contract drives it with a `fills`
      // override, which also sets `musicUrl` (one control, two keys).
      schema: z.string().optional(),
      label: 'Background Music',
      control: 'custom',
      default: '',
      sample: 'tea-pop',
      derived: true,
    },
    musicUrl: {
      schema: z.string().optional(),
      label: 'Background Music',
      control: 'custom',
      default: '',
      sample: '',
      derived: true,
    },
    musicVolume: {
      // A Radix slider, not a labelled input.
      schema: z.number().min(0).max(1).default(0.05),
      label: 'Background Music Volume',
      control: 'custom',
      default: 0.05,
      sample: 0.1,
      derived: true,
    },
    captionsEnabled: {
      schema: z.boolean().default(true),
      label: 'Enable Captions',
      control: 'switch',
      default: true,
      sample: true,
      derived: true,
    },
    fontFamily: {
      schema: z.enum(CAPTION_FONTS).default('inter'),
      label: 'Caption Font',
      control: 'select',
      default: 'inter',
      sample: 'montserrat',
      sampleLabel: 'Montserrat',
      derived: true,
    },
    textColor: {
      // <input type="color"> — cannot be typed into, so the contract sets it.
      schema: z.string().default('#FFFFFF'),
      label: 'Text Color',
      control: 'custom',
      default: '#FFFFFF',
      sample: '#facc15',
      derived: true,
    },
    backgroundColor: {
      schema: z.string().default('#000000'),
      label: 'Background Color',
      control: 'custom',
      default: '#000000',
      sample: '#101010',
      derived: true,
    },
    position: {
      schema: z.enum(['top', 'center', 'bottom']).default('bottom'),
      label: 'Caption Position',
      control: 'radio',
      default: 'bottom',
      sample: 'top',
      sampleLabel: 'Top',
      derived: true,
    },
    outroStyle: {
      schema: z.enum(['offer', 'location', 'tagline']).default('tagline'),
      label: 'Outro Style',
      control: 'radio',
      default: 'tagline',
      sample: 'location',
      sampleLabel: 'Location',
      derived: true,
    },
  },
});

/** The three outro styles, with the labels the picker renders. */
export const outroStyleOptions = Object.entries(outroStyleLabels) as [
  'offer' | 'location' | 'tagline',
  string,
][];

export const backgroundFootageStepSchema = z.object({
  // Slot-based clip selection
  clips: clipSlotsSchema.default({ bRoll: [], templateSlots: {} }),
  // Music, captions, outro style and title — the SAME per-field schemas the
  // customise step and the form contract use, not a second copy of them.
  ...specShape(videoCustomiseForm.specs),
  // Stock-footage selection. These are step-level state rather than labelled
  // customise-form fields, so they sit alongside the spec shape rather than in
  // `videoCustomiseForm.specs`.
  //
  // Opt-in to curated stock footage. Regardless of this toggle, the backend
  // still auto-fills from stock when the final b-roll list ends up empty.
  allowStockFootage: z.boolean().default(false),
  // Explicitly picked stock clip IDs from StockClipPicker, minted into org
  // assets on submit and appended to uploaded b-roll.
  stockClipIds: z.array(z.string()).default([]),
});

/**
 * Customization step schema (music + captions only, no media selection)
 */
export const customizationOnlyStepSchema = videoCustomiseForm.schema;

/**
 * Base video form schema (without cross-field refinements for step-level use).
 * scriptStepSchema has a refine so we use its inner shape.
 *
 * For the full schema, scriptText and talkingHeadUrl are relaxed because offer
 * templates skip the script step entirely. Cross-field refinements below enforce
 * them only when the template is NOT an offer (detected via offerHeadline).
 */
const scriptStepBaseShape = {
  scriptText: z.string().default(''),
  narrationType: z
    .enum(['recorded', 'ai_voiceover', 'text_only'])
    .default('recorded'),
  aiVoiceId: z.string().optional(),
  textFrames: z
    .array(
      z.object({
        id: z.string(),
        text: z.string().min(1),
        durationSec: z.number().min(0.5).max(10),
        style: z
          .enum(['default', 'question', 'answer', 'disclaimer', 'cta'])
          .optional(),
      })
    )
    .optional(),
};

const offerStepBaseShape = {
  offerId: z.string().optional(),
  offerHeadline: z.string().optional(),
  bulletPoints: z.array(z.string()).max(4).optional(),
  ctaText: z.string().optional(),
  urgencyText: z.string().optional(),
  audienceText: z.string().optional(),
};

export const videoFormSchema = z
  .object({
    ...serviceStepSchema.shape,
    ...scriptStepBaseShape,
    ...talkingHeadStepSchema.shape,
    ...captionReviewStepSchema.shape,
    ...backgroundFootageStepSchema.shape,
    ...offerStepBaseShape,
  })
  .refine(
    (data) => {
      // Offer templates don't use AI voiceover
      if (data.offerHeadline != null) return true;
      return data.narrationType !== 'ai_voiceover' || !!data.aiVoiceId;
    },
    {
      message: 'Please select a voice',
      path: ['aiVoiceId'],
    }
  )
  .refine(
    (data) => {
      // Offer templates use text_only — no script or talking head needed
      if (data.offerHeadline != null) return true;
      return (
        data.narrationType === 'ai_voiceover' ||
        data.narrationType === 'text_only' ||
        (data.talkingHeadUrl && data.talkingHeadUrl.length > 0)
      );
    },
    {
      message: 'Please upload your talking head video',
      path: ['talkingHeadUrl'],
    }
  )
  .refine(
    (data) => {
      // Offer templates don't need a script
      if (data.offerHeadline != null) return true;
      // Educational (text_only) templates skip the script step — scriptText
      // is populated from the AI-generated script at submit time
      if (data.narrationType === 'text_only') return true;
      return data.scriptText.length > 0;
    },
    {
      message: 'Script is required',
      path: ['scriptText'],
    }
  );

export type VideoFormData = z.infer<typeof videoFormSchema>;

export const defaultVideoFormValues: VideoFormData = {
  serviceId: undefined,
  scriptText: '',
  narrationType: 'recorded',
  aiVoiceId: undefined,
  talkingHeadUrl: '',
  clips: { bRoll: [], templateSlots: {} },
  musicTrackId: undefined,
  musicUrl: undefined,
  musicVolume: 0.05,
  captionsEnabled: true,
  fontFamily: 'inter',
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  position: 'bottom',
  outroStyle: 'tagline',
  title: '',
  allowStockFootage: false,
  stockClipIds: [],
  // Caption review
  editedCaptionText: undefined,
  // Offer step defaults
  offerId: undefined,
  offerHeadline: undefined,
  bulletPoints: undefined,
  ctaText: undefined,
  urgencyText: undefined,
  audienceText: undefined,
};

/**
 * Per-slot media step validation schema.
 * For required ordered slots, ensures at least one video is selected.
 * For optional slots, always passes.
 */
export function createMediaStepSchema(
  slot: SlotConfig,
  options: { allowStockFootageBypassesRequired?: boolean } = {}
) {
  if (!slot.required) {
    // Optional slots — always valid
    return z.object({}).passthrough();
  }

  // Required ordered slots — must have at least one video
  return z
    .object({
      allowStockFootage: z.boolean().default(false),
      stockClipIds: z.array(z.string()).default([]),
      clips: z
        .object({
          templateSlots: z.record(z.string(), z.array(z.string())).default({}),
        })
        .passthrough(),
    })
    .passthrough()
    .refine(
      (data) => {
        if (options.allowStockFootageBypassesRequired) {
          return true;
        }
        const val = data.clips?.templateSlots?.[String(slot.order)];
        return Array.isArray(val) && val.length > 0;
      },
      {
        message: `Select at least one ${slot.label.toLowerCase()} video`,
        path: ['clips'],
      }
    );
}

/**
 * Maps a font family name to a caption font enum value.
 * Accepts both display names ("Inter") and the lowercase enum values
 * ("inter"), so it works for brand styles and the org video default alike.
 */
export function mapFontFamilyToCaptionFont(fontFamily: string): CaptionFont {
  const normalized = fontFamily.trim().toLowerCase();
  if ((CAPTION_FONTS as readonly string[]).includes(normalized)) {
    return normalized as CaptionFont;
  }
  const fontMap: Record<string, CaptionFont> = {
    Inter: 'inter',
    Montserrat: 'montserrat',
    Roboto: 'roboto',
    Poppins: 'poppins',
    'Bebas Neue': 'bebas-neue',
    'Playfair Display': 'playfair-display',
  };
  return fontMap[fontFamily.trim()] ?? 'inter';
}

/**
 * Organization-level video defaults that new videos inherit.
 * Mirrors the `video*` columns on the organization table.
 */
export interface OrgVideoDefaults {
  captionColor: string | null;
  captionFont: string | null;
  captionPosition: 'top' | 'center' | 'bottom' | null;
  musicVolume: number | null;
}

/**
 * Creates video form default values based on organization brand and the
 * organization's explicit video defaults.
 *
 * Precedence for caption/music settings: org video defaults > brand content
 * style > standard fallback defaults.
 */
export function createBrandedVideoFormDefaults(
  brand: OrganizationBrandResponse | null,
  videoDefaults?: OrgVideoDefaults | null
): VideoFormData {
  const base: VideoFormData = brand?.resolvedStyle
    ? {
        ...defaultVideoFormValues,
        narrationType: 'recorded' as const,
        fontFamily: mapFontFamilyToCaptionFont(
          brand.resolvedStyle.captionStyle.fontFamily
        ),
        textColor: brand.resolvedStyle.captionStyle.color,
        backgroundColor: brand.resolvedStyle.captionStyle.backgroundColor,
      }
    : { ...defaultVideoFormValues };

  if (!videoDefaults) {
    return base;
  }

  return {
    ...base,
    ...(videoDefaults.captionFont
      ? { fontFamily: mapFontFamilyToCaptionFont(videoDefaults.captionFont) }
      : {}),
    ...(videoDefaults.captionColor
      ? { textColor: videoDefaults.captionColor }
      : {}),
    ...(videoDefaults.captionPosition
      ? { position: videoDefaults.captionPosition }
      : {}),
    ...(videoDefaults.musicVolume != null
      ? { musicVolume: videoDefaults.musicVolume }
      : {}),
  };
}
