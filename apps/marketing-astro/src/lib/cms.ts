/**
 * Server-side CMS fetch utility for Contentful Content Delivery API.
 * Used in server components for SSR/ISR blog pages.
 */

import { createClient } from 'contentful';

const CONTENTFUL_SPACE_ID = process.env.CONTENTFUL_SPACE_ID;
const CONTENTFUL_ACCESS_TOKEN = process.env.CONTENTFUL_ACCESS_TOKEN;

function getClient() {
  if (!CONTENTFUL_SPACE_ID || !CONTENTFUL_ACCESS_TOKEN) return null;

  return createClient({
    space: CONTENTFUL_SPACE_ID,
    accessToken: CONTENTFUL_ACCESS_TOKEN,
  });
}

export async function fetchEntries<T>(
  contentType: string,
  query?: Record<string, unknown>
): Promise<{ items: T[]; total: number }> {
  const client = getClient();
  if (!client) return { items: [], total: 0 };

  try {
    const response = await client.getEntries({
      content_type: contentType,
      ...query,
    });

    return {
      items: response.items.map((item) => ({
        ...item.fields,
        id: item.sys.id,
        createdAt: item.sys.createdAt,
        updatedAt: item.sys.updatedAt,
      })) as T[],
      total: response.total,
    };
  } catch (error) {
    console.error(`Contentful fetch failed for ${contentType}:`, error);
    return { items: [], total: 0 };
  }
}

export async function fetchEntryBySlug<T>(
  contentType: string,
  slug: string
): Promise<T | null> {
  const client = getClient();
  if (!client) return null;

  try {
    const response = await client.getEntries({
      content_type: contentType,
      'fields.slug': slug,
      include: 2,
      limit: 1,
    });

    const item = response.items[0];
    if (!item) return null;

    return {
      ...item.fields,
      id: item.sys.id,
      createdAt: item.sys.createdAt,
      updatedAt: item.sys.updatedAt,
    } as T;
  } catch (error) {
    console.error(`Contentful fetch failed for ${contentType}/${slug}:`, error);
    return null;
  }
}
