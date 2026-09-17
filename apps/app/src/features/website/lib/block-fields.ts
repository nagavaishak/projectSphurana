import {
  BLOCK_VARIANTS,
  type Block,
  type BlockType,
  DATA_BOUND_BLOCKS,
} from '@borradh-workspace/web-shared';

/**
 * The inspector's form definition.
 *
 * HOW THIS IS DERIVED, and why it is not generated: §5 says the inspector is
 * "generated from the block's Zod schema", and those schemas live in
 * `packages/features/src/microsites/blocks/schemas.ts` — which this app must
 * not import. What `@borradh-workspace/web-shared` exports is the block union
 * as TYPES plus `BLOCK_VARIANTS` as a runtime value; types are erased at
 * runtime, so there is nothing to reflect over and no way to build the form
 * purely from what the contract ships.
 *
 * So the field table below is written by hand, but it is BOUND to the contract
 * at compile time: `FieldsFor<PropsOf<T>>` is a mapped type over every key of
 * the block's props, so adding, renaming or removing a prop in
 * `web-shared/src/microsites/contract.ts` breaks `pnpm turbo typecheck` here
 * rather than quietly dropping a field out of the inspector. The variant list
 * is read from `BLOCK_VARIANTS` directly — never retyped, since that list
 * already disagreed across two files once.
 *
 * The honest limitation: it captures the SHAPE, not the Zod constraints
 * (min-length, url, enum bounds). Client-side validation is therefore coarse
 * and the server's schema stays the authority; a rejected patch surfaces as the
 * mutation's error toast. Making this generated for real needs the block schema
 * metadata published from web-shared as a runtime value.
 */

export type BlockFieldKind =
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'boolean'
  | 'number'
  | 'select'
  | 'stringList'
  | 'assetId';

export interface BlockFieldDescriptor {
  kind: BlockFieldKind;
  label: string;
  description?: string;
  /** For `select`. */
  options?: readonly string[];
  placeholder?: string;
}

type PropsOf<T extends BlockType> = Extract<Block, { type: T }>['props'];

/** Exhaustive over the props: a missing key is a compile error. */
type FieldsFor<P> = { [K in keyof Required<P>]: BlockFieldDescriptor };

export const BLOCK_FIELDS: { [T in BlockType]: FieldsFor<PropsOf<T>> } = {
  hero: {
    headline: { kind: 'text', label: 'Headline' },
    subheadline: { kind: 'textarea', label: 'Subheadline' },
    imageAssetId: {
      kind: 'assetId',
      label: 'Image',
      description: 'Asset id or image URL.',
    },
    ctaLabel: { kind: 'text', label: 'Button label' },
    ctaHref: {
      kind: 'text',
      label: 'Button link',
      description: 'An internal path like /book, or a full URL.',
    },
  },
  services: {
    title: { kind: 'text', label: 'Title' },
    intro: { kind: 'textarea', label: 'Intro' },
    categoryNames: {
      kind: 'stringList',
      label: 'Categories',
      description:
        'Category names, comma separated. Leave empty to show every active service.',
    },
    limit: { kind: 'number', label: 'Maximum shown' },
    showPrices: { kind: 'boolean', label: 'Show prices' },
  },
  team: {
    title: { kind: 'text', label: 'Title' },
    intro: { kind: 'textarea', label: 'Intro' },
    practitionerIds: {
      kind: 'stringList',
      label: 'Team members',
      description: 'Practitioner ids. Leave empty to show the whole team.',
    },
    showBios: { kind: 'boolean', label: 'Show bios' },
  },
  gallery: {
    title: { kind: 'text', label: 'Title' },
    assetIds: {
      kind: 'stringList',
      label: 'Photos',
      description: 'Asset ids. Leave empty to use your photo gallery.',
    },
  },
  opening_hours: {
    title: { kind: 'text', label: 'Title' },
    locationId: { kind: 'text', label: 'Location id' },
    showExceptions: { kind: 'boolean', label: 'Show holiday hours' },
  },
  map_location: {
    title: { kind: 'text', label: 'Title' },
    locationId: { kind: 'text', label: 'Location id' },
    showAddress: { kind: 'boolean', label: 'Show address' },
    showMap: { kind: 'boolean', label: 'Show map' },
  },
  cta_booking: {
    headline: { kind: 'text', label: 'Headline' },
    subtext: { kind: 'textarea', label: 'Supporting text' },
    buttonLabel: { kind: 'text', label: 'Button label' },
  },
  rich_text: {
    markdown: { kind: 'markdown', label: 'Content' },
    align: { kind: 'select', label: 'Alignment', options: ['left', 'center'] },
  },
};

export const BLOCK_LABELS: Record<BlockType, string> = {
  hero: 'Hero',
  services: 'Services',
  team: 'Team',
  gallery: 'Gallery',
  opening_hours: 'Opening hours',
  map_location: 'Location',
  cta_booking: 'Booking call to action',
  rich_text: 'Text',
};

const dataBound = new Set<string>(DATA_BOUND_BLOCKS);

/**
 * Data-bound blocks hold a QUERY, not a copy of the data — the inspector says
 * so, or a user edits a service name here and wonders why the site disagrees
 * with the booking widget.
 */
export function isDataBoundBlock(type: BlockType): boolean {
  return dataBound.has(type);
}

/** The variants the renderer can actually draw for this block. */
export function variantsFor(type: BlockType): readonly string[] {
  return BLOCK_VARIANTS[type];
}

/** Field descriptors in declaration order, for a stable form layout. */
export function fieldsFor(
  type: BlockType
): { key: string; field: BlockFieldDescriptor }[] {
  const fields = BLOCK_FIELDS[type] as Record<string, BlockFieldDescriptor>;
  return Object.entries(fields).map(([key, field]) => ({ key, field }));
}

/** A short, human label for a block in the outline and the transcript. */
export function blockTitle(block: Block): string {
  const props = block.props as Record<string, unknown>;
  const candidate =
    typeof props.headline === 'string'
      ? props.headline
      : typeof props.title === 'string'
        ? props.title
        : undefined;
  const trimmed = candidate?.trim();
  return trimmed ? trimmed : BLOCK_LABELS[block.type];
}
