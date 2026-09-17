/**
 * Extract metadata and text content from HTML.
 *
 * Pure functions operating on raw HTML strings via regex.
 */

/**
 * Extract metadata (title, description, OG tags, JSON-LD) from HTML.
 * Useful as fallback when body text is sparse (e.g. SPAs, heavily JS-rendered sites).
 */
export function extractMetadataFromHtml(html: string): string {
  const parts: string[] = [];

  // Title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) parts.push(`Title: ${titleMatch[1].trim()}`);

  // Meta description
  const descMatch = html.match(
    /<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i
  );
  if (descMatch?.[1]) parts.push(`Description: ${descMatch[1].trim()}`);

  // OG tags
  const ogPatterns = [
    { name: 'og:title', label: 'OG Title' },
    { name: 'og:description', label: 'OG Description' },
    { name: 'og:site_name', label: 'Site Name' },
  ];
  for (const { name, label } of ogPatterns) {
    const match = html.match(
      new RegExp(
        `<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']+)["']`,
        'i'
      )
    );
    if (match?.[1]) parts.push(`${label}: ${match[1].trim()}`);
  }

  // JSON-LD structured data
  const jsonLdMatches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (jsonLdMatches) {
    for (const block of jsonLdMatches.slice(0, 3)) {
      const content = block.replace(/<\/?script[^>]*>/gi, '').trim();
      try {
        const parsed = JSON.parse(content);
        const jsonStr = JSON.stringify(parsed);
        if (jsonStr.length < 3000) {
          parts.push(`Structured data: ${jsonStr}`);
        }
      } catch {
        // Skip malformed JSON-LD
      }
    }
  }

  return parts.join('\n');
}

/**
 * Extract text content from HTML, stripping tags and scripts.
 * Limited to first 15000 characters to stay within token limits.
 */
export function extractTextFromHtml(html: string): string {
  // Remove script and style tags with their content
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  // If body text is sparse, prepend metadata (title, description, OG, JSON-LD)
  if (text.length < 200) {
    const metadata = extractMetadataFromHtml(html);
    if (metadata) {
      text = `${metadata}\n\n${text}`;
    }
  }

  // Limit to ~15000 characters to stay within token limits
  return text.slice(0, 15000);
}
