/**
 * Extract structured data (JSON-LD, embedded JSON) from HTML.
 *
 * Pure functions operating on raw HTML strings via regex.
 */

/**
 * Extract JSON-LD structured data for location information.
 */
export function extractJsonLdLocations(html: string): string {
  const jsonLdMatches = html.match(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  if (!jsonLdMatches) return '';

  const locationParts: string[] = [];
  for (const block of jsonLdMatches) {
    const content = block.replace(/<\/?script[^>]*>/gi, '').trim();
    try {
      const parsed = JSON.parse(content);
      const types = Array.isArray(parsed['@type'])
        ? parsed['@type']
        : [parsed['@type']];
      const locationTypes = [
        'LocalBusiness',
        'Organization',
        'Place',
        'MedicalBusiness',
        'HealthAndBeautyBusiness',
        'BeautySalon',
        'DaySpa',
        'HairSalon',
      ];
      if (types.some((t: string) => locationTypes.includes(t))) {
        const addr = parsed.address;
        if (addr) {
          locationParts.push(
            `Structured data location: ${JSON.stringify(addr)}`
          );
        }
        // Check for multiple locations
        if (parsed.department && Array.isArray(parsed.department)) {
          for (const dept of parsed.department) {
            if (dept.address) {
              locationParts.push(
                `Branch location: ${JSON.stringify(dept.address)}`
              );
            }
          }
        }
        // Extract opening hours from JSON-LD
        if (parsed.openingHoursSpecification) {
          locationParts.push(
            `Opening hours: ${JSON.stringify(parsed.openingHoursSpecification)}`
          );
        }
        if (parsed.openingHours) {
          locationParts.push(
            `Opening hours: ${JSON.stringify(parsed.openingHours)}`
          );
        }
      }
    } catch {
      // Skip malformed JSON-LD
    }
  }
  return locationParts.join('\n');
}

/** Keywords that signal location-relevant embedded data */
const LOCATION_DATA_KEYWORDS =
  /address|streetAddress|latitude|longitude|branch|clinic|store|postal|zipcode|postalCode|addressLocality/i;

/**
 * Extract embedded location data from script tags.
 * Checks __NEXT_DATA__ (Next.js), __NUXT__ (Nuxt), and generic
 * application/json script blocks for location-relevant JSON.
 */
export function extractEmbeddedLocationData(html: string): string {
  const parts: string[] = [];

  // 1. Next.js __NEXT_DATA__
  const nextMatch = html.match(
    /<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextMatch?.[1]) {
    try {
      const data = JSON.parse(nextMatch[1]);
      const propsStr = JSON.stringify(data?.props?.pageProps ?? '');
      if (LOCATION_DATA_KEYWORDS.test(propsStr)) {
        parts.push(propsStr.slice(0, 4000));
      }
    } catch {
      /* malformed */
    }
  }

  // 2. Generic <script type="application/json"> blocks (Drupal, custom frameworks)
  const jsonScripts = html.matchAll(
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  );
  for (const m of jsonScripts) {
    const content = m[1]?.trim();
    if (!content || content.length < 30 || content.length > 50000) continue;
    if (LOCATION_DATA_KEYWORDS.test(content)) {
      parts.push(content.slice(0, 2000));
    }
  }

  // 3. Inline JSON assignments: window.__data = {...}, window.__INITIAL_STATE__ = {...}
  const inlineJsonMatches = html.matchAll(
    /window\.__[A-Z_]+__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/gi
  );
  for (const m of inlineJsonMatches) {
    const content = m[1]?.trim();
    if (!content || content.length < 30 || content.length > 50000) continue;
    if (LOCATION_DATA_KEYWORDS.test(content)) {
      try {
        JSON.parse(content); // validate it's real JSON
        parts.push(content.slice(0, 2000));
      } catch {
        /* skip if not valid JSON */
      }
    }
  }

  return parts.join('\n').slice(0, 4000);
}
