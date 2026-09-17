/**
 * Compose the default page set — Home, About, Services, Contact.
 *
 * TWO INVARIANTS, both enforced here rather than trusted:
 *
 * 1. **Home always has a `cta_booking`.** It is the conversion path (plan §10,
 *    where it is also the one block the agent may never delete). Composition
 *    fails loudly rather than publishing a site with no way to book.
 *
 * 2. **Data-bound blocks carry no business data.** `services`, `team`,
 *    `opening_hours` and `map_location` get a QUERY — a limit, a location id,
 *    a couple of display flags — and authored framing copy. Service names,
 *    prices, practitioner names, hours and addresses are NEVER written into
 *    props: they render live, so a price change in the dashboard shows on the
 *    website with no republish. That is the differentiator; denormalising here
 *    quietly destroys it. `assertNoBusinessDataInProps` below is the guard.
 *
 * Every block goes through its Zod schema before it can reach the document.
 * The copy fields are model output and jsonb tells you nothing at read time,
 * so this is the last gate before a public page.
 */

import { randomUUID } from 'node:crypto';
import type { Block, MicrositePage } from '@borradh-workspace/web-shared';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { blockSchema, micrositePageSchema } from '../../blocks/index.js';
import type { MicrositeOrgContext } from './provision-context.js';
import type { MicrositeCopy } from './provision-microsite.schema.js';

/** Blocks whose props are a query. Nothing derived from org rows may go in. */
const DATA_BOUND_TYPES = new Set<Block['type']>([
  'services',
  'team',
  'opening_hours',
  'map_location',
]);

/** How many services the home page teases before "see all". */
const HOME_SERVICES_LIMIT = 6;

type BlockDraft = { type: Block['type']; variant: string; props: unknown };

const draft = (
  type: Block['type'],
  variant: string,
  props: unknown
): BlockDraft => ({ type, variant, props });

/**
 * The one place a data-bound block's props are checked for smuggled business
 * data.
 *
 * Three kinds of prop live on a data-bound block and they are treated
 * differently on purpose:
 *   - POINTERS (`locationId`, `practitionerIds`, `categoryNames`, `limit`) — how
 *     the block knows what to query. Allowed, obviously.
 *   - AUTHORED COPY (`title`, `intro`) — the agent's framing prose. Excluded
 *     from the scan: a heading that happens to contain the word "facials" is
 *     not a stale copy of the service list, and failing provisioning over one
 *     would be the LLM breaking the site by another route.
 *   - ANYTHING ELSE holding a string — the shape this guard exists to catch. A
 *     future prop that quietly denormalises a service name or an address is
 *     what destroys the live-data differentiator, and jsonb will never tell
 *     you.
 */
const AUTHORED_COPY_PROPS = new Set(['title', 'intro']);

function findLeakedBusinessData(
  type: Block['type'],
  props: Record<string, unknown>,
  context: MicrositeOrgContext
): string | null {
  if (!DATA_BOUND_TYPES.has(type)) return null;

  const needles = [
    ...context.serviceNames,
    ...(context.city ? [context.city] : []),
  ]
    .map((n) => n.trim().toLowerCase())
    .filter((n) => n.length >= 3);

  for (const [key, value] of Object.entries(props)) {
    if (AUTHORED_COPY_PROPS.has(key)) continue;
    if (typeof value !== 'string') continue;
    const haystack = value.toLowerCase();
    const hit = needles.find((n) => haystack.includes(n));
    if (hit) return `${type}.${key} contains live business data ("${hit}")`;
  }
  return null;
}

function buildPage(
  args: {
    path: string;
    title: string;
    order: number;
    description: string;
    drafts: BlockDraft[];
  },
  context: MicrositeOrgContext
): Result<MicrositePage> {
  const blocks: Block[] = [];

  for (const d of args.drafts) {
    const candidate = {
      id: randomUUID(),
      type: d.type,
      variant: d.variant,
      props: d.props,
    };

    const parsed = blockSchema.safeParse(candidate);
    if (!parsed.success) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Invalid ${d.type} block on ${args.path}`,
          { issues: parsed.error.issues }
        )
      );
    }

    const leak = findLeakedBusinessData(
      parsed.data.type,
      parsed.data.props as Record<string, unknown>,
      context
    );
    if (leak) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Data-bound block would go stale: ${leak}`
        )
      );
    }

    blocks.push(parsed.data as Block);
  }

  const page = micrositePageSchema.safeParse({
    id: randomUUID(),
    path: args.path,
    title: args.title,
    seo: {
      title: `${args.title} | ${context.organizationName}`,
      description: args.description.slice(0, 300),
    },
    blocks,
    order: args.order,
    isSystem: false,
  });

  if (!page.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid microsite page ${args.path}`,
        { issues: page.error.issues }
      )
    );
  }

  return ok(page.data as MicrositePage);
}

export function composeDefaultPages(
  context: MicrositeOrgContext,
  copy: MicrositeCopy
): Result<MicrositePage[]> {
  const cta = draft('cta_booking', 'band', {
    headline: copy.ctaHeadline,
    subtext: copy.ctaSubtext,
    buttonLabel: 'Book now',
  });

  const servicesBlock = (limit?: number) =>
    draft('services', 'cards', {
      title: 'Services',
      intro: copy.servicesIntro,
      ...(limit ? { limit } : {}),
      showPrices: true,
    });

  const teamBlock = draft('team', 'grid', {
    title: 'Meet the team',
    showBios: true,
  });

  const mapBlock = draft('map_location', 'split', {
    title: 'Find us',
    ...(context.locationId ? { locationId: context.locationId } : {}),
    showAddress: true,
    showMap: true,
  });

  const hoursBlock = draft('opening_hours', 'table', {
    title: 'Opening hours',
    ...(context.locationId ? { locationId: context.locationId } : {}),
    // Exceptions are in no public payload yet (plan §5) — asking for them
    // would render an empty section.
    showExceptions: false,
  });

  const home: BlockDraft[] = [
    draft('hero', 'image-right', {
      headline: copy.heroHeadline,
      subheadline: copy.heroSubheadline,
      ctaLabel: 'Book now',
      // Internal path. NEVER built from WEB_URL — see plan §6.5.
      // NO ctaHref: the renderer falls back to the resolved booking url, which
      // is the only value that can be right on every tier. A literal baked in
      // at provisioning time cannot — '/book' 404s on the path tier, and any
      // absolute form breaks when the tenant moves to their own domain.
    }),
  ];
  if (context.serviceCount > 0) home.push(servicesBlock(HOME_SERVICES_LIMIT));
  if (context.practitionerCount > 0) home.push(teamBlock);
  if (context.hasPhotos)
    home.push(draft('gallery', 'grid', { title: 'Our work' }));
  // The conversion path. Unconditional, and asserted below.
  home.push(cta);
  if (context.locationId) home.push(mapBlock);

  const about: BlockDraft[] = [
    draft('rich_text', 'prose', { markdown: copy.aboutMarkdown }),
  ];
  if (context.practitionerCount > 0) about.push(teamBlock);
  about.push(cta);

  /**
   * The Services page keeps its services block even when the org has none yet.
   * The block is a QUERY: it fills itself the moment a service is added, with
   * no republish and no agent turn. The home page teaser is conditional
   * because an empty section above the fold looks broken; a dedicated page
   * that is briefly thin does not.
   */
  const services: BlockDraft[] = [servicesBlock(), cta];

  const contact: BlockDraft[] = [
    draft('rich_text', 'narrow', { markdown: copy.contactIntro }),
  ];
  if (context.locationId) contact.push(mapBlock);
  if (context.hasOpeningHours || context.locationId) contact.push(hoursBlock);
  contact.push(cta);

  const specs = [
    {
      path: '/',
      title: 'Home',
      order: 0,
      description: copy.heroSubheadline,
      drafts: home,
    },
    {
      path: '/about',
      title: 'About',
      order: 1,
      description: copy.heroSubheadline,
      drafts: about,
    },
    {
      path: '/services',
      title: 'Services',
      order: 2,
      description: copy.servicesIntro,
      drafts: services,
    },
    {
      path: '/contact',
      title: 'Contact',
      order: 3,
      description: copy.contactIntro,
      drafts: contact,
    },
  ];

  const pages: MicrositePage[] = [];
  for (const spec of specs) {
    const page = buildPage(spec, context);
    if (!page.success) return err(page.error);
    pages.push(page.data);
  }

  const homePage = pages.find((p) => p.path === '/');
  if (!homePage?.blocks.some((b) => b.type === 'cta_booking')) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Home page has no cta_booking block'
      )
    );
  }

  return ok(pages);
}
