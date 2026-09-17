/**
 * `generateTemplatedSingle` — generate ONE branded graphic from a curated
 * single-graphic template.
 *
 *   1. Look up the single template (layout set-prompt + copy-spec).
 *   2. Write the copy to that spec for the service/topic (one Claude call).
 *   3. Load the template's inspiration image (S3 / local-dir override).
 *   4. Render via `generateBrandedGraphic` — inspiration image as the layout
 *      reference, fully rebranded, with the written copy.
 *
 * Mirrors the carousel orchestrator's per-slide step, for a standalone post.
 */

import { createAnthropicClient } from '@borradh-workspace/ai';
import {
  offer as offerTable,
  organization,
  organizationService,
} from '@borradh-workspace/database';
import {
  createLogger,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import { eq } from 'drizzle-orm';
import {
  type Currency,
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  formatPrice,
  ok,
} from '../../../shared/index.js';
import { getOrgCurrency } from '../../../shared/org-context.js';
import {
  briefWithTopic,
  getSingleTemplate,
  loadSingleInspiration,
  resolveSingleBrief,
} from '../../carousel-templates/index.js';
import {
  type GenerateBrandedGraphicOutput,
  generateBrandedGraphic,
} from '../generate-branded-graphic/index.js';
import { selectInspirationSet } from '../select-inspiration-set/index.js';
import {
  type AdGraphicOffer,
  type GenerateTemplatedSingleInput,
  generateTemplatedSingleSchema,
} from './generate-templated-single.schema.js';

const PLAN_MODEL = 'claude-sonnet-4-6';

const log = createLogger('TemplatedSingle');

/**
 * Optional user-instruction block appended to a copy-writer user message.
 *
 * When we have the copy that was actually rendered last time, hand it over and
 * demand a SURGICAL edit. Without it the writer produces a fresh deck: asking
 * to change the headline rewrote the body and the CTA too, because there was
 * no previous text to preserve — the single biggest "editing doesn't work"
 * complaint.
 */
export function buildRefinementBlock(
  refinementInstruction?: string,
  priorCopy?: string | null
): string {
  const instruction = refinementInstruction?.trim();
  if (!instruction) return '';

  const prior = priorCopy?.trim();
  if (!prior) {
    return `\n\nThe user reviewed the previous version and asked for this change — apply it while still following the spec: ${instruction}`;
  }

  return [
    '',
    '',
    'THIS IS AN EDIT, NOT A REWRITE.',
    '',
    'The copy currently on the graphic is:',
    '---',
    prior,
    '---',
    '',
    `The user asked for this change: ${instruction}`,
    '',
    'Return the SAME copy with ONLY that change applied. Every other word, line',
    'and line-break must be reproduced EXACTLY as above — do not reword,',
    're-order, improve or shorten anything the user did not ask you to change.',
    'If the change affects only one line, the other lines must come back',
    'byte-for-byte identical.',
  ].join('\n');
}

/**
 * Write copy from a semantic BRIEF rather than a template's copy-spec.
 *
 * The spec dictates form — "~5-9 words", "a footer instruction (e.g. VOTE A OR
 * B BELOW)", "attribution: a first name" — and the model obliges, which is how
 * a production batch shipped an invented client with a five-star rating and a
 * vote prompt. A brief says only what the post is ABOUT and leaves the words
 * and their arrangement to be worked out from the subject.
 *
 * The prohibitions here are the ones the specs used to violate, stated once as
 * rules instead of being re-broken per template.
 */
async function writeBriefCopy(
  businessName: string,
  serviceName: string,
  serviceDescription: string | null,
  brief: string,
  refinementInstruction?: string,
  priorCopy?: string | null
): Promise<string> {
  const client = createAnthropicClient();
  const system = `You write the on-image copy for ONE Instagram graphic for a service business. Output ONLY the words that appear on the image — no labels, no quotes, no commentary. Use "\n" line breaks between lines.

Keep it short enough to read at a glance: a headline of at most 8 words, and at most 30 words of supporting copy across no more than two sentences. One idea per graphic. Length is a hard constraint — copy that overruns gets set smaller and smaller until the graphic is a paragraph. But a limit is not a licence to truncate: the headline must be a complete thought that ends where it means to, never a sentence cut off to fit.

The BUSINESS and the SERVICE are different things. Refer to the business by its own name; never call the business by the service's name.

NEVER write: a customer name, a quotation attributed to a customer, a star rating or review score, a statistic or percentage you cannot source from what you were told, a price, a before/after results claim, a "swipe"/"swipe up"/"tap"/"vote"/"comment below"/"link in bio" instruction, a hashtag, or an emoji. If the brief seems to call for one of those, write around it — the post is about the subject, not the engagement.

Be factually careful about the service. Say nothing about results you were not told.`;
  const user = `Business: ${businessName}\nService: ${serviceName}${serviceDescription ? ` — ${serviceDescription}` : ''}\n\nWhat this post is about:\n${brief}${buildRefinementBlock(refinementInstruction, priorCopy)}\n\nWrite the copy now.`;
  const message = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

async function writeCopy(
  serviceName: string,
  serviceDescription: string | null,
  topic: string,
  copySpec: string,
  templateLabel: string,
  refinementInstruction?: string,
  priorCopy?: string | null
): Promise<string> {
  const client = createAnthropicClient();
  const system = `You write the copy for a single Instagram graphic that follows a fixed template. Output ONLY the rendered copy text — no labels, no quotes, no explanation. The copy MUST follow the spec exactly: the style, the approximate word count, and the structure. Use "\\n" line breaks where the spec implies separate lines/items. Be factually careful about the service; do not invent claims.`;
  const user = `Service: ${serviceName}${serviceDescription ? ` — ${serviceDescription}` : ''}\nTopic: ${topic}\nTemplate: ${templateLabel}\n\nCopy spec:\n${copySpec}${buildRefinementBlock(refinementInstruction, priorCopy)}\n\nWrite the copy now.`;
  const message = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

/**
 * Turn an offer record into a plain-English brief for the copy writer, plus the
 * BADGE expression for the hero. We NEVER express an offer as a percentage —
 * the brand always shows the price drop as "Was X, Now Y". Only when there's
 * no regular price to anchor against do we fall back to the single offer price.
 * Prices are formatted in the org's currency (derived from its location) so
 * US/UK orgs don't get "€".
 */
function describeOffer(
  offer: AdGraphicOffer,
  currency: Currency
): {
  brief: string;
  badgeHint: string;
} {
  const money = (cents: number) => formatPrice(cents, currency);
  const parts: string[] = [];
  let badgeHint = '';

  const now =
    offer.offerPriceCents != null ? money(offer.offerPriceCents) : null;
  const was =
    offer.originalPriceCents != null ? money(offer.originalPriceCents) : null;

  if (was && now) {
    // The standard case: a clear price drop. Always Was/Now, never a %.
    parts.push(`intro price ${now}, was ${was}`);
    badgeHint = `Was ${was} Now ${now}`;
  } else if (now) {
    // Only the offer price is known — show it on its own (still no %).
    parts.push(`price ${now}`);
    badgeHint = now;
  } else if (
    offer.discountType === 'fixed_amount' &&
    offer.discountAmountCents != null
  ) {
    parts.push(`${money(offer.discountAmountCents)} off`);
    badgeHint = `${money(offer.discountAmountCents)} OFF`;
  }
  // No price information at all → fall through to the offer name below. We
  // deliberately do NOT emit a "% OFF" badge in any branch.

  if (offer.limitPerClient) parts.push('new clients only');
  if (offer.validUntil) {
    const d = new Date(offer.validUntil);
    if (!Number.isNaN(d.getTime())) {
      // Explicitly UTC, and deliberately NOT the org's zone. `offer.validUntil`
      // is a `timestamp` WITHOUT time zone — a naive wall-clock date the owner
      // picked, which the driver reads back against the server zone (UTC) and
      // this service hands on as an ISO string. It is a calendar date wearing
      // an instant's clothes. Re-reading that instant in a different zone
      // shifts it: a midnight-anchored 31 Aug becomes "30 Aug" anywhere west of
      // UTC, so the graphic would advertise the offer ending a day early.
      // Formatting in UTC returns the date the owner actually typed.
      parts.push(
        `ends ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
      );
    }
  }

  return {
    brief: parts.length > 0 ? parts.join(', ') : offer.name,
    badgeHint: badgeHint || offer.name,
  };
}

/**
 * Ad-copy writer: composes the labelled offer copy (TREATMENT / BADGE /
 * BENEFITS / CTA / VOUCHER) from the service + offer, to the template's spec.
 * The owner fills nothing — the LLM derives the punchy promotional copy.
 */
async function writeAdCopy(
  serviceName: string,
  serviceDescription: string | null,
  topic: string,
  copySpec: string,
  templateLabel: string,
  offer: AdGraphicOffer,
  currency: Currency,
  refinementInstruction?: string,
  priorCopy?: string | null
): Promise<string> {
  const { brief, badgeHint } = describeOffer(offer, currency);
  const client = createAnthropicClient();
  const system = `You write the on-image copy for a single PAID social-media OFFER AD that follows a fixed template. Output ONLY the rendered copy, with each region on its own labelled line exactly as the spec lists (e.g. "TREATMENT: ...", "BADGE: ...", "CTA: ..."). For a multi-line region like BENEFITS, put the label on its own line then each item on its own following line. Do NOT add quotes, commentary, or any region the spec does not ask for. The BADGE is the hero — it MUST show the price drop as "Was <old price> Now <new price>", using the offer's prices EXACTLY as given, including their currency symbol (never substitute a different currency). NEVER express the offer as a percentage — no "% off", no "50% OFF", ever. Be factually careful: never invent results, prices, or claims beyond the offer given.`;
  const user = `Service: ${serviceName}${serviceDescription ? ` — ${serviceDescription}` : ''}\nTopic: ${topic}\nTemplate: ${templateLabel}\n\nThe offer to promote: ${brief}.\nRecommended BADGE text (use this unless a tighter version is clearly better): ${badgeHint}.\n\nCopy spec (produce EXACTLY these labelled regions):\n${copySpec}${buildRefinementBlock(refinementInstruction, priorCopy)}\n\nWrite the labelled copy now.`;
  const message = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 1000,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return message.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .trim();
}

const generateTemplatedSingleImpl = async (
  db: DbConnection,
  input: GenerateTemplatedSingleInput
): Promise<Result<GenerateBrandedGraphicOutput>> => {
  const parsed = generateTemplatedSingleSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const {
    organizationId,
    serviceId,
    topic,
    templateSlug,
    model,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    imageryPolicy,
    usageType,
    offerId,
    refinementInstruction,
    priorImageUrl,
  } = parsed.data;

  /**
   * A COMPOSITION TEMPLATE IS AN AD THING NOW.
   *
   * Organic singles are described by a brief — subject only, appearance from
   * the brand's own posts — so they need no entry in the registry, and a
   * missing one must not fail the render. Ads still pin a layout: an offer's
   * price badge sits in a fixed region, which is a real requirement rather than
   * a description of a look, so for an ad the template is mandatory.
   *
   * `templateSlug` remains the pin either way, because that is what the app
   * sends and what `graphic.template_slug` stores.
   */
  const template = getSingleTemplate(templateSlug);
  if (!template && usageType === 'ad') {
    return err(
      new FeatureError(
        ErrorCodes.NOT_FOUND,
        `Single ad template not found: ${templateSlug}`
      )
    );
  }

  const [svc] = await db
    .select({
      name: organizationService.name,
      description: organizationService.description,
    })
    .from(organizationService)
    .where(eq(organizationService.id, serviceId))
    .limit(1);
  if (!svc) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }
  // The BUSINESS name — see the note in orchestrate-carousel. Without it the
  // copy writer treats the service name as the business.
  const [org] = await db
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  const isAd = usageType === 'ad';

  // ── Resolve the offer for ad graphics ────────────────────────────────
  let offer: AdGraphicOffer | undefined;
  if (isAd && offerId) {
    const [offerRow] = await db
      .select({
        name: offerTable.name,
        discountType: offerTable.discountType,
        discountPercent: offerTable.discountPercent,
        discountAmountCents: offerTable.discountAmountCents,
        originalPriceCents: offerTable.originalPriceCents,
        offerPriceCents: offerTable.offerPriceCents,
        limitPerClient: offerTable.limitPerClient,
        validUntil: offerTable.validUntil,
      })
      .from(offerTable)
      .where(eq(offerTable.id, offerId))
      .limit(1);
    if (offerRow) {
      offer = {
        name: offerRow.name,
        discountType: offerRow.discountType,
        discountPercent: offerRow.discountPercent,
        discountAmountCents: offerRow.discountAmountCents,
        originalPriceCents: offerRow.originalPriceCents,
        offerPriceCents: offerRow.offerPriceCents,
        limitPerClient: offerRow.limitPerClient,
        validUntil: offerRow.validUntil
          ? offerRow.validUntil.toISOString()
          : null,
      };
    }
  }

  // Display currency for offer prices, from the org's location country.
  const currency = await getOrgCurrency(db, organizationId);
  const priorCopy = input.priorCopy ?? null;

  // Organic singles take a BRIEF instead of a template's copy-spec. The pin is
  // honoured when it names a live brief — or the composition template a brief
  // took over from, so a row written before briefs had slugs regenerates as
  // what it first rendered.
  const brief = isAd
    ? null
    : resolveSingleBrief(templateSlug, parsed.data.graphicId ?? serviceId);
  const singleBrief = brief ? briefWithTopic(brief.brief, topic) : null;
  if (brief) {
    log.info('Single brief resolved', {
      organizationId,
      graphicId: parsed.data.graphicId,
      brief: brief.slug,
      pinned: templateSlug,
    });
  }

  let copy: string;
  try {
    copy = singleBrief
      ? await writeBriefCopy(
          org?.name ?? 'this business',
          svc.name,
          svc.description,
          singleBrief,
          refinementInstruction,
          priorCopy
        )
      : !template
        ? // Unreachable: a null brief means `isAd`, and an ad without a
          // template returned NOT_FOUND above. Stated rather than asserted so a
          // future edit to either branch fails here instead of at the model.
          (() => {
            throw new Error(
              'single: no brief and no composition template — nothing to write copy from'
            );
          })()
        : isAd && offer
          ? await writeAdCopy(
              svc.name,
              svc.description,
              topic,
              template.copySpec,
              template.label,
              offer,
              currency,
              refinementInstruction,
              priorCopy
            )
          : await writeCopy(
              svc.name,
              svc.description,
              topic,
              template.copySpec,
              template.label,
              refinementInstruction,
              priorCopy
            );
  } catch (error) {
    logError('imageGeneration.generateTemplatedSingle.copy', error, {
      feature: 'image-generation',
      extra: { organizationId, templateSlug },
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Failed to write copy.')
    ) as Result<GenerateBrandedGraphicOutput>;
  }

  /**
   * ONLY AN AD SENDS A CURATED SCREENSHOT.
   *
   * This was gated on `ORGANIC_TEMPLATE_SCREENSHOT_FREE`, a flag that no longer
   * decides anything: an organic single is described by a brief and has no
   * composition template, so there is nothing to load a screenshot from. An ad
   * does — its offer regions are pinned — and that is the whole remaining case.
   *
   * The flag's history is worth keeping even though the flag is gone. It first
   * suppressed the layout PROSE while still sending the screenshot, which is
   * backwards: an image of a finished design is a far stronger appearance
   * signal than a sentence describing a structure. The correction removed both,
   * which made the intended configuration unreachable at any value, and
   * production ran a fourth combination nothing had measured — no screenshot
   * and no prose. A five-slide deck came back with four slides in one design
   * language and a fifth that was an unrelated product ad.
   */
  const inspiration = isAd
    ? await loadSingleInspiration(templateSlug)
    : undefined;

  // Ad copy is region-labelled (TREATMENT/BADGE/BENEFITS/CTA/VOUCHER); tell the
  // model to map each labelled line to its region and not render the labels.
  //
  // The copy itself travels in the COPY CHANNEL (`renderCopy`), NOT inside this
  // string. This directive says only how to PLACE it. Leaving the copy here
  // while the channel stayed empty produced a self-contradictory prompt — the
  // serialiser appended "No copy has been planned for this graphic; do not
  // invent body text" underneath a directive that contained the body text — and
  // a single came back with the raw `Service: … was 150 euro now 130 euro …`
  // line drawn onto the canvas verbatim.
  const renderDirective = isAd
    ? 'The copy is labelled by region. Place each labelled piece in its matching region of the layout, and do NOT render the region labels themselves — only their text. The BADGE must be the single largest, boldest element.'
    : 'Lay the copy out per the layout above.';

  // When we are amending an EXISTING graphic and still have its previous copy,
  // ask for an edit rather than a fresh render.
  //
  // Preserving the copy string alone is not enough: the model re-renders the
  // whole graphic every time, so a one-word change still shifted the imagery
  // and re-set the type. Handing over the prior image AND the exact target
  // text turns it into "change what differs" — the model knows precisely what
  // the result must say, instead of composing from scratch and hoping.
  //
  // Claude still writes the target copy (it interprets asks like "make the
  // headline punchier", and it keeps `graphic.rendered_copy` honest — if the
  // image model alone rewrote the words we would never learn what it actually
  // rendered, and the NEXT edit would amend text that is no longer on the
  // graphic).
  const isAmendment = Boolean(priorCopy?.trim() && input.priorImageUrl);
  const slideDirective = isAmendment
    ? [
        'You are EDITING the supplied previous version of this graphic, not creating a new one.',
        '',
        'The copy must now read EXACTLY:',
        '---',
        copy,
        '---',
        '',
        'Change ONLY what differs from the previous version. The photography,',
        'colours, composition, type treatment, logo placement and every piece of',
        'text that did not change must be reproduced as they already are. Do not',
        're-compose, re-crop, restyle or re-typeset anything the change does not',
        'require.',
      ].join('\n')
    : renderDirective;

  // Resolve the brand's reference set HERE rather than inside the renderer, so
  // the single and carousel paths behave identically and the database read sits
  // at the level that owns the render instead of hiding in a leaf service.
  const inspirationSet = parsed.data.suppressBrandReferences
    ? null
    : await selectInspirationSet(db, { organizationId });
  const allStyleUrls = inspirationSet?.success ? inspirationSet.data.urls : [];
  const styleReferenceUrls =
    parsed.data.maxBrandReferences && parsed.data.maxBrandReferences > 0
      ? allStyleUrls.slice(0, parsed.data.maxBrandReferences)
      : allStyleUrls;

  const rendered = (await generateBrandedGraphic(db, {
    organizationId,
    serviceId,
    topic,
    model,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    imageryPolicy,
    styleReferenceUrls,
    referenceColourway: inspirationSet?.success
      ? (inspirationSet.data.colourway ?? undefined)
      : undefined,
    referenceLogoMatchFallback: inspirationSet?.success
      ? inspirationSet.data.logoMatchFallback
      : undefined,
    inspirationImageBase64: inspiration?.data,
    inspirationMediaType: inspiration?.mediaType,
    // A briefed single sends NO composition at all — the brand's own posts are
    // the design model, which is the configuration the local harness renders.
    layoutPrompt: singleBrief ? undefined : template?.layoutPrompt,
    slideDirective,
    // Amendments keep their copy inline: the directive is "make it read exactly
    // this, changing nothing else", which is an instruction about the edit
    // rather than a fresh copy plan.
    renderCopy: isAmendment ? undefined : { raw: copy },
    refinementInstruction,
    priorImageUrl,
    // Provenance: key the decision record to the artefact + the design.
    graphicId: input.graphicId,
    templateSlug,
    regenerationIntent: input.regenerationIntent,
  })) as Result<GenerateBrandedGraphicOutput>;

  // Surface the copy we actually rendered so the caller can persist it. The
  // NEXT regenerate needs it: without the previous text there is nothing to
  // preserve, so "change the headline" reissues the whole deck.
  if (rendered.success) {
    return ok({ ...rendered.data, renderedCopy: copy });
  }
  return rendered;
};

export const generateTemplatedSingle = (
  db: DbConnection,
  input: GenerateTemplatedSingleInput
) =>
  trackedResult(
    'imageGeneration.generateTemplatedSingle',
    () => generateTemplatedSingleImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateSlug: input.templateSlug,
      },
    }
  );

export type GenerateTemplatedSingleResult = Awaited<
  ReturnType<typeof generateTemplatedSingle>
>;
