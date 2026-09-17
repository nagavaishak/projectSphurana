import {
  assetSchema,
  generatedGraphicSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import { openContentProposal } from '@borradh-workspace/features/content-items';
import {
  DECK_BRIEFS,
  SINGLE_BRIEFS,
} from '@borradh-workspace/features/image-generation';
import { graphicCategoryValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  describeCreateBlocked,
  describeRenderBlocked,
} from '../../ports/reason-messages.js';
import { defineTool } from '../../tool-factory/index.js';
import {
  type AssetUnresolvedOutput,
  assetRefInputFields,
  resolveAssetReference,
} from '../_shared/asset-ref.js';

/**
 * Claire-facing video formats. Mirrors `VIDEO_FORMAT_TO_TEMPLATE_ID` in the
 * features-package `create-video.schema.ts`.
 *
 * `before_after` is RETIRED and deliberately absent — we cannot confirm a
 * before and an after are the same client and the same treatment, so the format
 * was withdrawn.
 */
const KNOWN_VIDEO_FORMATS = [
  'authority',
  'educational',
  'offer',
  'caption_tease',
  'ins_outs',
  'question_cta',
  'improves',
  'highlight_caption',
  'curiosity_hook',
  'step_timer',
  'time_progress',
  'poll',
  'myth_fact',
  'versus',
  'price_reveal',
  'client_question',
  'come_with_me',
] as const;

const DEFAULT_VIDEO_FORMAT: (typeof KNOWN_VIDEO_FORMATS)[number] =
  'educational';

const FORMAT_LABELS: Record<(typeof KNOWN_VIDEO_FORMATS)[number], string> = {
  authority: 'Authority (talking-head)',
  educational: 'Educational (text on screen)',
  offer: 'Offer (promo card)',
  caption_tease: 'Caption Tease (organic)',
  ins_outs: "In's & Out's (organic)",
  question_cta: 'Question + CTA (organic)',
  improves: 'Improves (organic)',
  highlight_caption: 'Highlight Caption (organic)',
  curiosity_hook: 'Curiosity Hook (organic)',
  step_timer: 'Step + Timer (organic)',
  time_progress: 'Time-lapse Progress (organic)',
  poll: 'Poll (organic)',
  myth_fact: 'Myth -> Fact (organic)',
  versus: 'X vs Y (organic)',
  price_reveal: 'Price Reveal (organic)',
  client_question: 'Client Question (organic)',
  come_with_me: 'Come With Me (organic)',
};

const ORIENTATION_LABELS: Record<string, string> = {
  portrait: 'Portrait',
  landscape: 'Landscape',
  square: 'Square',
};

const NARRATION_LABELS: Record<string, string> = {
  recorded: 'Recorded voice',
  ai_voiceover: 'AI voiceover',
  text_only: 'Text only',
};

const GRAPHIC_CATEGORIES = graphicCategoryValues;
const DEFAULT_GRAPHIC_CATEGORY: (typeof GRAPHIC_CATEGORIES)[number] = 'tips';

const CATEGORY_LABELS: Record<string, string> = {
  tips: 'Tips',
  motivation: 'Motivation',
  question: 'Question',
  storyline: 'Storyline',
};

/**
 * The organic styles Claire may ask for, derived from the brief registries so a
 * new brief is offered automatically. Each style implies its kind, which is why
 * `imageKind` is ignored when `style` is set.
 *
 * These are SUBJECTS, not layouts. Organic composition templates are gone —
 * they were superseded by briefs before a deck was ever built, so a style Claire
 * picked from that list was collected and ignored. Ad templates are not offered
 * here; Claire does not choose an offer ad's layout.
 */
const ORGANIC_STYLES = [
  ...DECK_BRIEFS.map((b) => ({
    slug: b.slug,
    label: b.label,
    kind: 'carousel' as const,
  })),
  ...SINGLE_BRIEFS.map((b) => ({
    slug: b.slug,
    label: b.label,
    kind: 'single' as const,
  })),
];

const STYLE_SLUGS = ORGANIC_STYLES.map((s) => s.slug) as [string, ...string[]];

const STYLE_LABELS: Record<string, string> = Object.fromEntries(
  ORGANIC_STYLES.map((s) => [s.slug, s.label])
);

const STYLE_CATALOG = ORGANIC_STYLES.map(
  (s) => `${s.slug} = ${s.label} [${s.kind}]`
).join('; ');

function truncate(text: string, max = 140): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

interface CreateContentOutput {
  /** The post. What every later EDIT addresses — see `patchContent`. */
  itemId?: string;
  /** The asset inside it. Present so status polling has something to poll. */
  videoId?: string;
  graphicId?: string;
  serviceId?: string;
  status?: string;
  uiState?: 'created';
  title?: string;
  fields?: { label: string; value: string }[];
  /** Selected b-roll, in render order. Empty is legitimate (stock auto-fill). */
  clipAssetIds?: string[];
  actions?: never[];
  /** Hydrated clip details, for the WhatsApp interactive list. */
  clips?: Array<{
    id: string;
    name: string;
    type: string;
    duration: number | null;
  }>;
  /** Created, but the requested render was refused. The draft still exists. */
  renderBlocked?: string;
  error?: string;
}

/*
 * There is deliberately NO `rendered` field on this output.
 *
 * It shipped `{ rendered: true, status: 'queued' }` 47 times in production. A
 * queued job is not a rendered video, but the field asserted it was, and Claire
 * told owners their video was rendering when some of those renders never
 * completed. `status` carries only what the server confirmed.
 */

/**
 * `content_createContent` — make a piece of content.
 *
 * ONE TOOL for what was three: `createDraftVideo`, `createGraphic` and
 * `createAdGraphic`. They were split by ASSET KIND, which is not what an owner
 * is choosing between — they ask for "a post about microneedling", and whether
 * that is a video or an image is a decision, not a routing problem. Three tools
 * meant three descriptions to keep in step, and the drift was real: only one of
 * them opened a content item, so a graphic could be edited afterwards and an ad
 * creative could not be edited at all.
 *
 * The counterpart to `patchContent`, and addressed the same way afterwards: both
 * return an `itemId`, which is the one id an edit takes.
 *
 * `kind` is explicit rather than inferred. An owner who says "make me a post"
 * has not chosen, and guessing on their behalf spends a render on the wrong
 * medium — ask which, once, and then never ask anything else.
 */
export const createContentTool = defineTool<
  {
    kind: 'video' | 'graphic';
    itemId?: string;
    serviceId: string;
    offerId?: string;
    title?: string;
    format?: (typeof KNOWN_VIDEO_FORMATS)[number];
    usage?: 'organic' | 'ad';
    templateId?: string;
    offerCopy?: {
      headline?: string;
      bulletPoints?: string[];
      ctaText?: string;
      urgencyText?: string;
    };
    autoRender?: boolean;
    category?: (typeof GRAPHIC_CATEGORIES)[number];
    imageKind?: 'single' | 'carousel';
    style?: (typeof STYLE_SLUGS)[number];
    topicSummary?: string;
    suppressCard?: boolean;
    assetRef?: string;
    generateNew?: boolean;
  },
  CreateContentOutput | AssetUnresolvedOutput
>({
  feature: 'content',
  action: 'createContent',
  description:
    'Make a piece of content — a VIDEO or a GRAPHIC — for one service. ' +
    'REQUIRED: kind, and serviceId (call listServices first to resolve it; ' +
    'cuid2 strings, pass through verbatim). If the owner did not say whether ' +
    'they want a video or an image, ask once — it is the only question worth ' +
    'asking, and everything else defaults. If the org has ZERO services, do ' +
    'not call this: tell them to add one via Services → New Service.\n' +
    'VIDEO: pass a format — ad (authority, educational, offer) or organic ' +
    '(caption_tease, ins_outs, question_cta, improves, and the rest). The ' +
    'server writes the script and on-screen copy from the service. This does ' +
    'NOT render: the card shows the defaults and the owner approves.\n' +
    'GRAPHIC: pass a category (tips, motivation, question, storyline) matching ' +
    'their intent, and optionally a style to pin a layout. Rendering starts ' +
    'immediately — a graphic costs nothing — and the card auto-polls, so do ' +
    'NOT call a status tool after.\n' +
    'PASS offerId when the post promotes an offer. On a graphic that makes it ' +
    'a paid-ad creative whose badge and copy come from the offer; on a video ' +
    'it is REQUIRED by format "offer". Resolve it with listOffers, or create ' +
    'one first with createOffer / suggestIntroOffer. Never ask the owner to ' +
    'type a price or a discount — those come from the offer.\n' +
    'DURATION IS AUTOMATIC: there is no length or clip-count input; the ' +
    'template and its clips decide the runtime. Never promise "a 15-second ' +
    'cut". For any change after this returns, use patchContent.',
  inputSchema: z.object({
    itemId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'RE-PROPOSING a graphic. Pass the item id from the card when the ' +
          'owner wants the same proposal made differently ("do it as a ' +
          'carousel instead", "make it a myth-bust") — it replaces that ' +
          'proposal rather than opening a second one beside it. Omit for a ' +
          'new post. Videos have no proposal stage: the draft IS the thing and ' +
          'costs nothing until it is rendered, so change one with ' +
          'patchContent instead.'
      ),
    kind: z
      .enum(['video', 'graphic'])
      .describe(
        'video = a rendered clip; graphic = a still image or carousel. Ask ' +
          'the owner if they have not said — do not guess, it spends a render.'
      ),
    serviceId: z
      .string()
      .min(1)
      .describe(
        'REQUIRED. The organization service this post is about — without it ' +
          'the copy renders literal "[SERVICE NAME]" placeholders. Resolve ' +
          'via listServices; match by name when they named one, otherwise ' +
          'take the strongest candidate (top of catalogue).'
      ),
    offerId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The offer this post promotes. REQUIRED when a video’s format is ' +
          '"offer". On a graphic it selects the paid-ad composer: the badge, ' +
          'treatment name, benefits and CTA are built from the offer, so do ' +
          'not ask the owner to type price or discount text.'
      ),
    title: z
      .string()
      .min(1)
      .max(100)
      .optional()
      .describe('Optional override for the auto-derived title.'),
    usage: z
      .enum(['organic', 'ad'])
      .optional()
      .describe(
        'VIDEO ONLY. `organic` = a social post, `ad` = a paid ad creative. ' +
          'Defaults to ad. Pass organic whenever the owner asked for a post, ' +
          'a reel or something for their socials rather than an ad.'
      ),
    format: z
      .enum(KNOWN_VIDEO_FORMATS)
      .optional()
      .describe(
        'VIDEO ONLY. OMIT IT unless the owner named a specific style — with ' +
          'no format the server rotates through the organic templates, so ' +
          'asking twice does not produce the same layout twice. Pass one only ' +
          'when they asked for that kind of video ("a myth-bust", "a poll", ' +
          '"a price reveal"). Ad formats: authority ' +
          '(talking-head expertise), educational (text-on-screen explainer), ' +
          'offer (promo card — REQUIRES offerId). Organic formats: ' +
          'caption_tease (typewriter headline + caption), ins_outs (in vs out ' +
          'list), question_cta (question + read-caption CTA), improves ' +
          '(benefit beats), highlight_caption, curiosity_hook, step_timer, ' +
          'time_progress, poll, myth_fact, versus, price_reveal, ' +
          'client_question, come_with_me. Pick an organic format when they ' +
          'want a social post rather than an ad.'
      ),
    templateId: z
      .string()
      .optional()
      .describe('VIDEO ONLY. Explicit backend template ID. Overrides format.'),
    offerCopy: z
      .object({
        headline: z
          .string()
          .min(1)
          .max(60)
          .optional()
          .describe('The big line on the offer video (≤60 chars).'),
        bulletPoints: z
          .array(z.string().min(1).max(50))
          .min(1)
          .max(4)
          .optional()
          .describe('3–4 short benefit lines (≤50 chars each).'),
        ctaText: z
          .string()
          .min(1)
          .max(25)
          .optional()
          .describe('The call-to-action, e.g. "Book now" (≤25 chars).'),
        urgencyText: z
          .string()
          .min(1)
          .max(50)
          .optional()
          .describe('Optional urgency line, e.g. "Limited spots".'),
      })
      .optional()
      .describe(
        'OFFER VIDEOS ONLY. Custom on-video wording when the owner dictates ' +
          'it. Pass only the fields they specified — the rest auto-generate, ' +
          'and pricing and branding always come from the offer. To change the ' +
          'copy AFTER the video exists, use patchContent.'
      ),
    autoRender: z
      .boolean()
      .optional()
      .describe(
        'VIDEO ONLY. Defaults false — the draft is created but NOT rendered, ' +
          'so the owner approves the defaults on the card. Set true only when ' +
          'they asked to create AND render in one message, or inside the ' +
          'create-campaign flow where the launch is already approved.'
      ),
    category: z
      .enum(GRAPHIC_CATEGORIES)
      .optional()
      .describe(
        'GRAPHIC ONLY. Editorial angle: tips = actionable advice, motivation ' +
          '= inspirational, question = engagement prompt, storyline = ' +
          'narrative. Defaults to tips.'
      ),
    imageKind: z
      .enum(['single', 'carousel'])
      .optional()
      .describe(
        'GRAPHIC ONLY. single = one image, carousel = multi-slide. Omit to ' +
          'let the system pick — only pass it when the owner explicitly ' +
          'asked. Ignored when style is set (each style implies its kind).'
      ),
    style: z
      .enum(STYLE_SLUGS)
      .optional()
      .describe(
        `GRAPHIC ONLY. Pin a curated layout. Only pass when they asked for a specific format (a testimonial, a poll, a comparison, a myth-bust, a Q&A) — omit to let the system rotate. Options: ${STYLE_CATALOG}.`
      ),
    topicSummary: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional one-line topic override. Omit and the server derives one ' +
          'from the service name.'
      ),
    suppressCard: z
      .boolean()
      .optional()
      .describe(
        'When true, the chat shows NO card. Pass this in the create-campaign ' +
          'flow, where the content is only the creative for a draft ad and ' +
          'the combined ad card is what the owner reviews. Leave off for ' +
          'standalone requests.'
      ),
    ...assetRefInputFields,
  }),
  destructive: false,
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating content' },
  execute: async (input, ctx) => {
    if (input.kind === 'graphic') {
      // No-silent-substitution: this GENERATES an AI image. If the owner
      // referenced one of their OWN uploads, refuse to quietly substitute —
      // resolve the reference (which, for a generate tool, means asking)
      // unless they explicitly opted in via generateNew.
      if (input.assetRef && input.generateNew !== true) {
        const resolution = await resolveAssetReference(ctx, {
          assetRef: input.assetRef,
          generateNew: input.generateNew,
          hasResolvedCreative: false,
          mode: 'generate',
          type: 'image',
        });
        if (resolution.outcome === 'unresolved') {
          return { data: resolution.data };
        }
      }

      const isAd = Boolean(input.offerId);
      const resolvedCategory = input.category ?? DEFAULT_GRAPHIC_CATEGORY;
      const fields: { label: string; value: string }[] = isAd
        ? [{ label: 'Type', value: 'Paid ad graphic' }]
        : [
            {
              label: 'Category',
              value: CATEGORY_LABELS[resolvedCategory] ?? resolvedCategory,
            },
          ];
      if (!isAd && input.imageKind) {
        fields.push({
          label: 'Type',
          value: input.imageKind === 'carousel' ? 'Carousel' : 'Single image',
        });
      }
      if (!isAd && input.style) {
        fields.push({
          label: 'Style',
          value: STYLE_LABELS[input.style] ?? input.style,
        });
      }

      // WEB, ORGANIC: propose first, generate on Accept.
      //
      // The card owns source-image selection — the owner picks which of their
      // uploads the design is built from — so creating the graphic here would
      // spend the render before they have chosen. WhatsApp has no picker, and a
      // paid-ad graphic composes from the offer rather than from uploads, so
      // both of those generate immediately.
      //
      // The proposal is an ITEM whose attempt 0 has no asset yet. That null is
      // what lets the card know it has already been acted on — the thing React
      // state forgets on every remount, which handed the Accept button back over
      // a proposal already accepted and spent a second render.
      if (!isAd && ctx.channel !== 'whatsapp') {
        // Re-proposing REUSES the item. A proposal stores nothing about what
        // was proposed — attempt 0 with a null asset is an existence marker,
        // not a spec — so revising one is this same call with different inputs.
        // Opening a second item instead would leave the card the owner is
        // looking at stale while a new one appears below it, and strand a row
        // for content that will never exist.
        //
        // Best-effort otherwise: without an item the card falls back to its old
        // browser-local behaviour rather than the proposal being lost.
        //
        // The one direct database call left in this vertical. There is no HTTP
        // surface that opens a proposal, and inventing one is the right fix —
        // noted rather than quietly kept.
        const item = input.itemId
          ? {
              success: true as const,
              data: { itemId: input.itemId, attemptId: undefined },
            }
          : await openContentProposal(db, {
              organizationId: ctx.organizationId,
              kind: 'graphic',
              source: 'claire_chat',
            }).catch(() => null);

        return {
          presentation: input.suppressCard
            ? { type: 'none' as const }
            : {
                type: 'graphic_draft' as const,
                ...(item?.success
                  ? { itemId: item.data.itemId, attemptId: item.data.attemptId }
                  : {}),
                serviceId: input.serviceId,
                category: resolvedCategory,
                ...(input.imageKind ? { kind: input.imageKind } : {}),
                ...(input.topicSummary
                  ? { topicSummary: input.topicSummary }
                  : {}),
                title: 'Graphic draft',
                fields,
              },
          data: {
            ...(item?.success ? { itemId: item.data.itemId } : {}),
            serviceId: input.serviceId,
            uiState: 'created' as const,
            title: 'Graphic draft',
            fields,
          },
        };
      }

      try {
        const created = await ctx.apiFetch('graphics/generate', {
          schema: generatedGraphicSchema,
          method: 'POST',
          body: {
            serviceId: input.serviceId,
            ...(isAd
              ? { usageType: 'ad', offerId: input.offerId }
              : {
                  category: resolvedCategory,
                  // A pinned style implies its kind server-side, so kind is
                  // only forwarded when no style is set.
                  ...(input.style
                    ? { templateSlug: input.style }
                    : input.imageKind
                      ? { kind: input.imageKind }
                      : {}),
                }),
            ...(input.topicSummary ? { topicSummary: input.topicSummary } : {}),
            ...(ctx.channel === 'whatsapp'
              ? {
                  whatsappDelivery: {
                    conversationId: ctx.conversationId,
                    userId: ctx.userId,
                  },
                }
              : {}),
          },
        });

        fields.push({
          label: 'Status',
          value: 'Generating — usually ready in under a minute',
        });

        return {
          presentation: input.suppressCard
            ? { type: 'none' as const }
            : {
                type: 'graphic_status' as const,
                graphicId: created.id,
                ...(created.itemId ? { itemId: created.itemId } : {}),
                status: created.status ?? 'rendering',
                title: created.title ?? (isAd ? 'Ad graphic' : 'Graphic'),
              },
          data: {
            graphicId: created.id,
            ...(created.itemId ? { itemId: created.itemId } : {}),
            status: created.status ?? 'rendering',
            serviceId: input.serviceId,
            uiState: 'created' as const,
            title: created.title ?? (isAd ? 'Ad graphic' : 'Graphic'),
            fields,
          },
        };
      } catch (error) {
        return {
          data: {
            error:
              error instanceof Error
                ? error.message
                : 'Failed to create the graphic',
          },
        };
      }
    }

    // An ORGANIC ask with no named format is left EMPTY on purpose, so the
    // server rotates through the organic templates the way graphics have
    // rotated since the batch planner. Filling it here is why every "make me an
    // organic video" came back as the same layout: Claire picks a format from
    // an enum, and she picks consistently.
    //
    // A format the owner DID name still wins — rotation only covers the case
    // where nobody chose. `educational` remains the default for ads, where
    // there is no organic pool to walk.
    const usage = input.usage ?? 'ad';
    const resolvedFormat = input.templateId
      ? input.format
      : usage === 'organic'
        ? input.format
        : (input.format ?? DEFAULT_VIDEO_FORMAT);

    // Everything about creating a video goes through the capability port. The
    // tool cannot see the HTTP response, so it cannot re-invent a `rendered`
    // flag from it — it gets a union it has to branch on.
    const result = await ctx.ports.videos.createDraft({
      serviceId: input.serviceId,
      format: resolvedFormat,
      templateId: input.templateId,
      offerId: input.offerId,
      title: input.title,
      // Owner-dictated offer copy rides through as a partial draftConfig; the
      // controller merges it over the generated card so pricing and branding
      // survive.
      offerCopy: input.offerCopy,
      usageType: usage,
      autoRender: input.autoRender === true,
    });

    if (result.status === 'blocked') {
      // Not created. There is no draft to describe, so the card is suppressed
      // and Claire relays the reason.
      const message = describeCreateBlocked(result.reason);
      if (result.reason.kind === 'server_error') {
        ctx.reportIssue('Failed to create draft video', {
          extra: { reason: result.reason },
        });
      }
      return { data: { error: message } };
    }

    const { draft } = result;

    // Hydrate clip details so the WhatsApp renderer can build an interactive
    // list — ids alone are not user-facing. Best-effort: a clip whose asset
    // lookup fails is simply omitted.
    let clips: Array<{
      id: string;
      name: string;
      type: string;
      duration: number | null;
    }> = [];
    if (draft.clipAssetIds.length > 0) {
      const settled = await Promise.allSettled(
        draft.clipAssetIds.map((id) =>
          ctx.apiFetch(`assets/${id}`, { schema: assetSchema }).then((a) => ({
            id: a.id,
            name: a.name || 'Clip',
            type: a.type || 'video',
            duration: a.duration ?? null,
          }))
        )
      );
      clips = settled.flatMap((r) =>
        r.status === 'fulfilled' ? [r.value] : []
      );
    }

    const fields: { label: string; value: string }[] = [];
    if (resolvedFormat) {
      fields.push({
        label: 'Format',
        value: FORMAT_LABELS[resolvedFormat] ?? resolvedFormat,
      });
    }
    if (draft.orientation) {
      fields.push({
        label: 'Orientation',
        value: ORIENTATION_LABELS[draft.orientation] ?? draft.orientation,
      });
    }
    if (draft.narrationType) {
      fields.push({
        label: 'Narration',
        value: NARRATION_LABELS[draft.narrationType] ?? draft.narrationType,
      });
    }
    if (draft.scriptText) {
      fields.push({ label: 'Script', value: truncate(draft.scriptText) });
    }
    if (draft.clipAssetIds.length > 0) {
      // Kept for WhatsApp, where these fields ARE the card — on web the clip
      // list is on screen and this line is one more thing restating it.
      fields.push({
        label: 'Clips',
        value: `${draft.clipAssetIds.length} picked`,
      });
    }

    // Duration is not an input to this tool (or the render pipeline) — the
    // template and its clips set the runtime. State it plainly so Claire cannot
    // narrate a specific length she never asked for.
    fields.push({ label: 'Length', value: 'Automatic (set by the template)' });

    // The status line says only what the server confirmed. "Queued" is not
    // "rendered", and the copy no longer implies it is.
    const renderBlocked =
      result.status === 'draft_render_refused'
        ? describeRenderBlocked(result.reason)
        : undefined;
    fields.push({
      label: 'Status',
      value:
        result.status === 'queued'
          ? "Queued for rendering — I'll let you know when it's done"
          : renderBlocked
            ? 'Draft saved — the render did not start'
            : 'Draft — awaiting your go-ahead to render',
    });

    // The card the owner gets on create IS the clip list editor. The clips are
    // already assembled server-side, so the honest thing to show is the video
    // itself with Accept / Change Clips / Reject under it. The card it replaced
    // was a spec sheet plus an empty tray reading "B-roll (0 / min 1) — pick at
    // least 1 clip before rendering", which asked the owner to assemble a video
    // the server had already assembled.
    //
    // `itemId` comes back on the response now that creating a video opens its
    // content item. It used to be fetched here with a direct database call,
    // which is how two of the three create tools ended up with lineage and the
    // third with none.
    return {
      presentation: input.suppressCard
        ? { type: 'none' as const }
        : result.status === 'queued'
          ? {
              type: 'video_status' as const,
              videoId: draft.videoId,
              status: 'queued',
              title: draft.title,
            }
          : draft.itemId
            ? {
                type: 'content_clips' as const,
                itemId: draft.itemId,
                // The stamp. Without it the card can never tell it has been
                // superseded, so an approved-and-rendered proposal keeps
                // offering Accept after a reload.
                ...(draft.attemptId ? { attemptId: draft.attemptId } : {}),
                renderCount: 0,
                title: draft.title,
                serviceId: draft.serviceId ?? input.serviceId,
                minClipCount: 1,
              }
            : {
                // Degraded: the item could not be opened. Worth showing the
                // draft anyway rather than losing it to a card upgrade.
                type: 'video_draft' as const,
                videoId: draft.videoId,
                title: draft.title,
                fields,
                serviceId: draft.serviceId ?? input.serviceId,
                clipAssetIds: draft.clipAssetIds,
                minClipCount: 1,
                ...(draft.textFrames.length > 0
                  ? { textFrames: draft.textFrames }
                  : {}),
              },
      data: {
        videoId: draft.videoId,
        ...(draft.itemId ? { itemId: draft.itemId } : {}),
        serviceId: draft.serviceId ?? input.serviceId,
        status: result.status === 'queued' ? 'queued' : 'draft',
        uiState: 'created' as const,
        title: draft.title,
        fields,
        clipAssetIds: draft.clipAssetIds,
        // No action buttons on the card — a follow-up ("render this", "make it
        // portrait") is the next message in chat. Inline buttons on every card
        // are noise; per-owner preference, same rule as createCampaign.
        actions: [],
        ...(clips.length > 0 ? { clips } : {}),
        ...(renderBlocked ? { renderBlocked } : {}),
      },
    };
  },
});
