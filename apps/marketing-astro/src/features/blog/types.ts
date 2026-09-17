import type { Document } from '@contentful/rich-text-types';
import type { Asset, Entry } from 'contentful';

export interface CMSCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

export interface CMSTag {
  id: string;
  name: string;
  slug: string;
}

export interface CMSPost {
  id: string;
  title: string;
  slug: string;
  excerpt?: string | null;
  content: Document;
  featuredImage?: Asset | null;
  category?: Entry | null;
  tags?: Entry[] | null;
  publishedAt?: string | null;
  author?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  canonicalUrl?: string | null;
  readingTime?: number | null;
  createdAt: string;
  updatedAt: string;
}

export function isAsset(value: unknown): value is Asset {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sys' in value &&
    (value as { sys: { type: string } }).sys.type === 'Asset'
  );
}

export function isEntry(value: unknown): value is Entry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'sys' in value &&
    (value as { sys: { type: string } }).sys.type === 'Entry'
  );
}

export function getImageUrl(
  asset: Asset | null | undefined,
  width?: number
): string {
  if (!isAsset(asset)) return '';
  const url = asset.fields?.file?.url;
  if (!url || typeof url !== 'string') return '';
  const protocol = url.startsWith('//') ? `https:${url}` : url;
  return width ? `${protocol}?w=${width}&fm=webp` : protocol;
}

export function getImageAlt(asset: Asset | null | undefined): string {
  if (!isAsset(asset)) return '';
  return (
    (asset.fields?.title as string) ||
    (asset.fields?.description as string) ||
    ''
  );
}

export function getImageDimensions(
  asset: Asset | null | undefined
): { width: number; height: number } | null {
  if (!isAsset(asset)) return null;
  const details = asset.fields?.file?.details as
    | { image?: { width: number; height: number } }
    | undefined;
  if (!details?.image) return null;
  return { width: details.image.width, height: details.image.height };
}

export function getCategoryFields(
  entry: Entry | null | undefined
): CMSCategory | null {
  if (!isEntry(entry)) return null;
  return {
    id: entry.sys.id,
    name: entry.fields.name as string,
    slug: entry.fields.slug as string,
    description: (entry.fields.description as string) || null,
  };
}

export function getTagFields(entry: Entry | null | undefined): CMSTag | null {
  if (!isEntry(entry)) return null;
  return {
    id: entry.sys.id,
    name: entry.fields.name as string,
    slug: entry.fields.slug as string,
  };
}

export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '';
  return new Date(dateString).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}
