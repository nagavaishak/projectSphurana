import type { Asset } from '@borradh-workspace/api-client/types';

export interface ImagePickerLibrary {
  ordered: Asset[];
  serviceLinked: Set<string>;
}

/**
 * How many images the picker preselects before the owner touches it.
 *
 * ONE, because a single graphic attaches exactly ONE subject photo to the
 * model: `resolveSlotImage` picks a single asset out of `sourceAssetIds` and
 * the remainder are never sent. Preselecting ten therefore PROMISED ten and
 * shipped one, with nothing in the UI or the logs saying so — an owner who
 * picked ten photos and got a graphic built from the first one had no way to
 * tell that the other nine had been discarded rather than considered.
 */
export const DEFAULT_SUBJECT_IMAGE_COUNT = 1;

/** Default ordered selection shown before the owner changes the picker. */
export function getDefaultServiceImageIds(
  serviceAssets: Asset[],
  maxCount = DEFAULT_SUBJECT_IMAGE_COUNT
): string[] {
  return [
    ...new Set(
      serviceAssets
        .filter((asset) => asset.type === 'image' && asset.source === 'raw')
        .map((asset) => asset.id)
    ),
  ].slice(0, maxCount);
}

/**
 * What will actually happen, in order, given the two imagery permissions.
 *
 * The toggles say what is PERMITTED; an owner reading them still has to work
 * out what that adds up to. Two independent switches describe four different
 * behaviours, and the strictest — real photos or nothing — is both the one
 * people specifically ask for and the one that is invisible from the switch
 * positions alone. So it gets said in words.
 *
 * Mirrors `imageryPolicyFromLegacyFlags` in the features package: the org's own
 * assets are tried first under every policy, and the flags only decide what
 * backstops them.
 */
export function describeImageryOrder(opts: {
  hasChosenImages: boolean;
  allowStockImages: boolean;
  allowAiImages: boolean;
}): string {
  const tiers = [
    opts.hasChosenImages ? 'your chosen photo' : 'your uploaded photos',
  ];
  if (opts.allowStockImages) tiers.push('curated stock');
  if (opts.allowAiImages) tiers.push('AI imagery');

  return tiers.length === 1
    ? `${tiers[0]} — and if there are none, a text-led design with no photo.`
    : `${tiers.join(' → ')}.`;
}

/** Uploaded raw images only, with service-linked matches first. */
export function buildImagePickerLibrary(
  allAssets: Asset[],
  serviceAssets: Asset[]
): ImagePickerLibrary {
  const images = allAssets.filter(
    (asset) => asset.type === 'image' && asset.source === 'raw'
  );
  const uploadedById = new Map(images.map((asset) => [asset.id, asset]));
  const serviceImages = serviceAssets.filter(
    (asset) => asset.type === 'image' && asset.source === 'raw'
  );
  const serviceLinked = new Set(serviceImages.map((asset) => asset.id));
  const ordered: Asset[] = [];
  const seen = new Set<string>();

  for (const asset of serviceImages) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    ordered.push(uploadedById.get(asset.id) ?? asset);
  }
  for (const asset of images) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    ordered.push(asset);
  }
  return { ordered, serviceLinked };
}

export function filterImagePickerLibrary(
  assets: Asset[],
  activeTag: string,
  search: string
): Asset[] {
  const query = search.trim().toLowerCase();
  return assets.filter((asset) => {
    if (activeTag !== 'all' && !asset.tags.includes(activeTag)) return false;
    if (!query) return true;
    return (
      asset.name.toLowerCase().includes(query) ||
      asset.tags.some((tag) => tag.toLowerCase().includes(query))
    );
  });
}
