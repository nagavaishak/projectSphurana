/**
 * Synthesize a complete `VideoDraftConfig` from org defaults + template
 * signals + an optional service. This is the "defaults always fill in"
 * primitive for the W3 one-prompt video creation flow.
 *
 * Pure function — no DB access, no Result wrapping. The caller (controller
 * layer) loads the org defaults + the optional service row, then hands them
 * here. Always returns a valid full config; never returns partial state.
 *
 * Format fallback chain:
 *   1. Caller-provided `templateId` wins (legacy / explicit).
 *   2. Else `format` (LLM-facing alias) → `VIDEO_FORMAT_TO_TEMPLATE_ID`.
 *   3. Else `authority` (see `DEFAULT_TEMPLATE_ID`). This was `before-after`
 *      until that format was retired for making unverifiable claims.
 *
 * Variation: caller's `variationId` wins, else the first variation in the
 * template (deterministic — random selection happens later in
 * `createVideoImpl` if the variation isn't pre-picked here).
 *
 * Service signals: when `service` is provided we use its name for the title
 * default and its description (if any) as the script seed. Talking-head
 * details (camera videos, voice IDs) are NOT auto-populated — those require
 * deliberate user action (the talking-head QR flow, etc.).
 */

import type { OrgDefaults } from '../../../org-defaults/index.js';
import {
  CONTENT_IDEA_TEMPLATES,
  type ContentIdeaTemplate,
  type TemplateVariation,
  getTemplateById,
  getVariationById,
} from '../../templates/index.js';
import type { DraftConfig } from './create-video.schema.js';
import { VIDEO_FORMAT_TO_TEMPLATE_ID } from './create-video.schema.js';

export interface SynthesizeDraftConfigInput {
  orgDefaults: OrgDefaults;
  /** Backend template ID (`before-after`, `authority`, ...). Optional. */
  templateId?: string;
  /** LLM-facing alias (`before_after`, etc.). Used when `templateId` absent. */
  format?: string;
  /** Specific variation; auto-picked from the template when absent. */
  variationId?: string;
  /**
   * Optional service signals. Pass `{ name, description? }` to seed the title
   * and the script. Pass null / undefined to skip.
   */
  service?: {
    id?: string;
    name?: string | null;
    description?: string | null;
  } | null;
  /**
   * Optional organization signals. `businessName` flows into the outro;
   * `logoUrl` populates the outro logo when set.
   */
  organization?: {
    name?: string | null;
    logoUrl?: string | null;
  } | null;
  /** Caller-supplied partial draftConfig — merged over synthesized defaults. */
  overrides?: Partial<DraftConfig>;
}

export interface SynthesizeDraftConfigOutput {
  /** Final, ready-to-insert draftConfig. */
  draftConfig: DraftConfig;
  /** Resolved template ID (`before-after`, ...). Always set. */
  templateId: string;
  /** Resolved variation ID. Always set when the template has variations. */
  variationId: string;
  /** Title default — caller's input wins, this is the fallback. */
  title: string;
}

/**
 * The format used when the caller names none, or names one we don't recognise.
 *
 * This was `before-after` until that format was retired (see
 * `RETIRED_TEMPLATE_IDS`) — which meant an unspecified or misspelled format
 * silently produced a before/after, making the least-verifiable format the
 * most-produced one. `authority` is the safe default: it needs no paired
 * media and makes no claim about a client's results.
 */
const DEFAULT_TEMPLATE_ID = 'authority';

/**
 * Pick a default template ID from format / fallback chain. Always returns a
 * known, non-retired template — `getTemplateById` declines retired ids, so a
 * caller asking for a withdrawn format lands on {@link DEFAULT_TEMPLATE_ID}
 * rather than failing.
 */
function resolveTemplateId(input: SynthesizeDraftConfigInput): string {
  if (input.templateId && getTemplateById(input.templateId)) {
    return input.templateId;
  }
  if (input.format) {
    const mapped =
      VIDEO_FORMAT_TO_TEMPLATE_ID[
        input.format as keyof typeof VIDEO_FORMAT_TO_TEMPLATE_ID
      ];
    if (mapped && getTemplateById(mapped)) {
      return mapped;
    }
    // Fallback: try the raw value (in case caller passed a backend template ID
    // through the `format` field by mistake).
    if (getTemplateById(input.format)) {
      return input.format;
    }
  }
  return DEFAULT_TEMPLATE_ID;
}

/**
 * Pick a variation for a template. Caller-supplied wins; otherwise the first
 * variation listed. Random selection is left to `createVideoImpl` (downstream
 * service) so the synthesizer stays deterministic + testable.
 */
function resolveVariation(
  template: ContentIdeaTemplate,
  variationId?: string
): TemplateVariation {
  if (variationId) {
    const explicit = template.variations.find((v) => v.id === variationId);
    if (explicit) return explicit;
  }
  // Deterministic default = first variation. The downstream `createVideoImpl`
  // randomly selects when no variationId is forwarded to it.
  return template.variations[0];
}

function mapOrientation(
  videoOrientation: string
): 'portrait' | 'landscape' | 'square' {
  // Landscape is never used for synthesised drafts — per user directive
  // 2026-05-17, all Claire-driven videos render portrait (or square if the
  // org default explicitly asks for square). Landscape is reserved for the
  // legacy wizard flow where the operator picks it explicitly through the
  // UI; that path provides a full draftConfig and doesn't pass through this
  // synthesiser.
  if (videoOrientation === 'square') return 'square';
  return 'portrait';
}

/**
 * Build the title default from the available signals. Order:
 *   1. Caller-supplied (not part of this fn — caller picks).
 *   2. Service name → `Lip filler — before & after` style.
 *   3. Template title.
 *   4. `New video`.
 */
function buildDefaultTitle(
  service: SynthesizeDraftConfigInput['service'],
  template: ContentIdeaTemplate
): string {
  if (service?.name) {
    return `${service.name} — ${template.title}`.slice(0, 100);
  }
  return template.title.slice(0, 100);
}

/**
 * Mirror of the worker's text_only fallback parser
 * (`apps/video-worker/src/main.ts` L708): split scriptText on newlines and
 * emit one text frame per non-blank line, with style heuristics for the
 * first line (question), CTA-flavoured lines (cta), and disclaimer-flavoured
 * lines (disclaimer); everything else is "answer".
 *
 * When the script has no newlines, the whole string becomes a single
 * question-styled frame — still valid for the worker's pre-flight gate
 * ("at least one text frame"), and the runtime parser will re-style on
 * render if anything's off.
 */
export function deriveTextFramesFromScript(scriptText: string): Array<{
  id: string;
  text: string;
  durationSec: number;
  style: 'question' | 'answer' | 'disclaimer' | 'cta';
}> {
  const lines = scriptText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  return lines.map((line, i) => {
    const lower = line.toLowerCase();
    let style: 'question' | 'answer' | 'disclaimer' | 'cta' = 'answer';
    if (i === 0) {
      style = 'question';
    } else if (
      // Detect CTA lines — anything imperative that asks the viewer to take
      // an action. Without DM patterns the worker silently falls back to
      // its hardcoded default ctaText ("DM to Learn More") which then
      // double-renders alongside the same line shown as an item.
      /\b(book|link in bio|consultation$|book now|dm (us|to|me|for)|send (us )?(a )?dm|message us|tap (to|the link)|swipe up|call (us|now)|reach out|get in touch|learn more|find out more|follow us|sign up)\b/i.test(
        lower
      ) &&
      !/results vary|consultation required/i.test(lower)
    ) {
      style = 'cta';
    } else if (/results vary|consultation required/i.test(lower)) {
      style = 'disclaimer';
    }
    return { id: `tf-${i}`, text: line, durationSec: 3, style };
  });
}

/**
 * Synthesize a complete draftConfig. See module docstring for design.
 */
export function synthesizeDraftConfig(
  input: SynthesizeDraftConfigInput
): SynthesizeDraftConfigOutput {
  const templateId = resolveTemplateId(input);
  const template = getTemplateById(templateId);

  if (!template) {
    // Defensive — `resolveTemplateId` always returns a known template, but
    // future template removals shouldn't crash callers. Fall back to the
    // first registered template.
    const fallback = CONTENT_IDEA_TEMPLATES[0];
    if (!fallback) {
      throw new Error(
        'synthesizeDraftConfig: no templates registered — cannot synthesize a default config'
      );
    }
    return synthesizeDraftConfig({ ...input, templateId: fallback.id });
  }

  // When the caller passed a `variationId` that points outside the resolved
  // template, prefer the variation's actual template (getVariationById
  // resolves cross-template).
  let resolvedTemplate = template;
  if (input.variationId) {
    const cross = getVariationById(input.variationId);
    if (cross) {
      resolvedTemplate = cross.template;
    }
  }
  const finalVariation = resolveVariation(resolvedTemplate, input.variationId);

  const businessName = input.organization?.name ?? '';
  const logoUrl = input.organization?.logoUrl ?? undefined;

  // Seed script from service description when available; otherwise leave the
  // variation's scriptTemplate (the LLM regenerates a real script via
  // `generateVideoScriptTool` shortly after creation).
  const scriptSeed =
    input.service?.description?.trim() || finalVariation.scriptTemplate || '';

  const orientation = mapOrientation(input.orgDefaults.videoOrientation);
  const resolvedNarrationType = finalVariation.narrationMode ?? 'recorded';

  // For text_only narration, the worker's pre-flight gate rejects an empty
  // `textFrames` array before its scriptText→textFrames fallback parser runs
  // (see `apps/video-worker/src/main.ts` — the "requires text frames, an offer
  // card, or an organic template config" check fires before the fallback at
  // L708). So we mirror the fallback's parsing here at synth time and emit a
  // single frame per non-blank line of scriptText. This keeps text_only drafts
  // renderable on creation without a separate "generate text frames" step.
  //
  // CRITICAL: `deriveTextFramesFromScript` returns `[]` when `scriptSeed` is
  // empty/whitespace (service has no description AND the variation has no
  // scriptTemplate, or an override blanked the script). A text_only draft with
  // no textFrames — and not later reshaped into an offer/organic block by the
  // controller — gets created + queued, then fails EVERY render retry in the
  // worker (the "text_only mode requires …" throw; observed as a permanently
  // wedged BullMQ job retrying ~6×/video in prod). We never want synth to emit
  // an unrenderable text_only draft, so guarantee at least one frame by falling
  // back to a title/business-name seed. The controller still overrides these
  // for offer/organic templates (it spreads its own block and clears
  // textFrames), so this fallback only matters for plain text_only drafts.
  let synthesizedTextFrames =
    resolvedNarrationType === 'text_only'
      ? deriveTextFramesFromScript(scriptSeed)
      : undefined;
  if (
    resolvedNarrationType === 'text_only' &&
    synthesizedTextFrames?.length === 0
  ) {
    const fallbackSeed =
      input.service?.name?.trim() ||
      input.organization?.name?.trim() ||
      resolvedTemplate.title.trim();
    synthesizedTextFrames = deriveTextFramesFromScript(fallbackSeed);
  }

  const synthesized: DraftConfig = {
    scriptText: scriptSeed,
    narrationType: resolvedNarrationType,
    ...(resolvedNarrationType === 'ai_voiceover' ? { aiVoiceId: 'alloy' } : {}),
    bRollClips: [],
    ...(synthesizedTextFrames && synthesizedTextFrames.length > 0
      ? { textFrames: synthesizedTextFrames }
      : {}),
    captions: {
      enabled: true,
      position: 'bottom',
      fontFamily: 'Inter',
      fontSize: 48,
      textColor: '#FFFFFF',
      highlightColor: '#FFD700',
      backgroundColor: '#000000',
      showBackground: true,
    },
    musicVolume: 0.15,
    outro: {
      ...(logoUrl ? { logoUrl } : {}),
      businessName,
      ctaText: 'Book Now',
      backgroundOpacity: 0.85,
      backgroundColor: '#000000',
      textColor: '#FFFFFF',
      durationSec: 4,
    },
    orientation,
  };

  // Apply caller overrides on top of the synthesized defaults. Top-level
  // primitives win; nested objects (`captions`, `outro`) get shallow-merged
  // so the caller can patch just `captions.enabled` without re-supplying the
  // whole captions block.
  if (input.overrides) {
    for (const [key, value] of Object.entries(input.overrides)) {
      if (value === undefined) continue;
      const k = key as keyof DraftConfig;
      const existing = synthesized[k];
      if (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        existing !== null &&
        existing !== undefined &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        (synthesized as Record<string, unknown>)[k] = {
          ...(existing as Record<string, unknown>),
          ...(value as Record<string, unknown>),
        };
      } else {
        (synthesized as Record<string, unknown>)[k] = value;
      }
    }
  }

  return {
    draftConfig: synthesized,
    templateId: resolvedTemplate.id,
    variationId: finalVariation.id,
    title: buildDefaultTitle(input.service, resolvedTemplate),
  };
}
