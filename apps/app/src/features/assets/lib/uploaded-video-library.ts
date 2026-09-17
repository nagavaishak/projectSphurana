import type { Asset } from '@borradh-workspace/api-client/types';

export interface UploadedVideoLibrary {
  ordered: Asset[];
  serviceLinked: Set<string>;
}

/**
 * Build a raw-upload-only video library. Assets linked to the promoted
 * service stay first, while the general gallery supplies the canonical signed
 * thumbnail shape and the remainder of the organisation's uploads.
 */
export function buildUploadedVideoLibrary(
  allAssets: Asset[],
  serviceAssets: Asset[]
): UploadedVideoLibrary {
  const uploaded = allAssets.filter(
    (asset) => asset.type === 'video' && asset.source === 'raw'
  );
  const uploadedById = new Map(uploaded.map((asset) => [asset.id, asset]));
  const serviceVideos = serviceAssets.filter(
    (asset) => asset.type === 'video' && asset.source === 'raw'
  );
  const serviceLinked = new Set(serviceVideos.map((asset) => asset.id));
  const ordered: Asset[] = [];
  const seen = new Set<string>();

  for (const asset of serviceVideos) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    ordered.push(uploadedById.get(asset.id) ?? asset);
  }

  for (const asset of uploaded) {
    if (seen.has(asset.id)) continue;
    seen.add(asset.id);
    ordered.push(asset);
  }

  return { ordered, serviceLinked };
}

export function filterUploadedVideoLibrary(
  assets: Asset[],
  activeTag: string,
  search: string,
  serviceFilter?: {
    serviceId: string;
    promotedServiceId?: string | null;
    promotedServiceAssetIds?: Set<string>;
  }
): Asset[] {
  const query = search.trim().toLowerCase();
  return assets.filter((asset) => {
    if (activeTag !== 'all' && !asset.tags.includes(activeTag)) return false;
    if (serviceFilter) {
      const matchesPromotedService =
        serviceFilter.serviceId === serviceFilter.promotedServiceId &&
        serviceFilter.promotedServiceAssetIds?.has(asset.id);
      const matchesLinkedService = asset.services?.some(
        (service) => service.id === serviceFilter.serviceId
      );
      if (!matchesPromotedService && !matchesLinkedService) return false;
    }
    if (
      query &&
      !asset.name.toLowerCase().includes(query) &&
      !asset.tags.some((tag) => tag.toLowerCase().includes(query))
    ) {
      return false;
    }
    return true;
  });
}
