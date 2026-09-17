import { describe, expect, it } from '@borradh-workspace/testing';
import {
  extractEmbeddedLocationData,
  extractJsonLdLocations,
} from './extract-structured-data.js';

describe('extractJsonLdLocations', () => {
  it('extracts address from LocalBusiness JSON-LD', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": "LocalBusiness",
        "name": "Test Clinic",
        "address": {
          "@type": "PostalAddress",
          "streetAddress": "123 Main St",
          "addressLocality": "Dublin"
        }
      }
      </script>
    `;
    const result = extractJsonLdLocations(html);
    expect(result).toContain('Structured data location:');
    expect(result).toContain('123 Main St');
    expect(result).toContain('Dublin');
  });

  it('extracts from HealthAndBeautyBusiness type', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": "HealthAndBeautyBusiness",
        "address": { "streetAddress": "45 Beauty Lane" }
      }
      </script>
    `;
    expect(extractJsonLdLocations(html)).toContain('45 Beauty Lane');
  });

  it('handles array @type', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": ["Organization", "LocalBusiness"],
        "address": { "streetAddress": "99 Corp Ave" }
      }
      </script>
    `;
    expect(extractJsonLdLocations(html)).toContain('99 Corp Ave');
  });

  it('extracts branch locations from departments', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": "Organization",
        "address": { "streetAddress": "HQ" },
        "department": [
          { "address": { "streetAddress": "Branch 1" } },
          { "address": { "streetAddress": "Branch 2" } }
        ]
      }
      </script>
    `;
    const result = extractJsonLdLocations(html);
    expect(result).toContain('Branch 1');
    expect(result).toContain('Branch 2');
    expect(result).toContain('Branch location:');
  });

  it('extracts opening hours', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": "LocalBusiness",
        "address": { "streetAddress": "1 Main" },
        "openingHoursSpecification": [{ "dayOfWeek": "Monday" }]
      }
      </script>
    `;
    const result = extractJsonLdLocations(html);
    expect(result).toContain('Opening hours:');
    expect(result).toContain('Monday');
  });

  it('extracts simple openingHours string', () => {
    const html = `
      <script type="application/ld+json">
      {
        "@type": "LocalBusiness",
        "address": { "streetAddress": "1 Main" },
        "openingHours": "Mo-Fr 09:00-17:00"
      }
      </script>
    `;
    expect(extractJsonLdLocations(html)).toContain('Mo-Fr 09:00-17:00');
  });

  it('handles multiple JSON-LD blocks', () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "LocalBusiness", "address": {"streetAddress": "Location A"}}
      </script>
      <script type="application/ld+json">
      {"@type": "BeautySalon", "address": {"streetAddress": "Location B"}}
      </script>
    `;
    const result = extractJsonLdLocations(html);
    expect(result).toContain('Location A');
    expect(result).toContain('Location B');
  });

  it('ignores non-location JSON-LD types', () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "BreadcrumbList", "itemListElement": []}
      </script>
    `;
    expect(extractJsonLdLocations(html)).toBe('');
  });

  it('skips malformed JSON gracefully', () => {
    const html = `
      <script type="application/ld+json">{invalid json here}</script>
      <script type="application/ld+json">
      {"@type": "LocalBusiness", "address": {"streetAddress": "Good One"}}
      </script>
    `;
    const result = extractJsonLdLocations(html);
    expect(result).toContain('Good One');
  });

  it('returns empty string when no JSON-LD found', () => {
    expect(extractJsonLdLocations('<html><body>No data</body></html>')).toBe(
      ''
    );
  });

  it('ignores JSON-LD without address', () => {
    const html = `
      <script type="application/ld+json">
      {"@type": "LocalBusiness", "name": "No Address Clinic"}
      </script>
    `;
    expect(extractJsonLdLocations(html)).toBe('');
  });
});

describe('extractEmbeddedLocationData', () => {
  it('extracts Next.js __NEXT_DATA__ with location keywords', () => {
    const html = `
      <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"locations":[{"streetAddress":"123 Main St","latitude":53.3}]}}}
      </script>
    `;
    const result = extractEmbeddedLocationData(html);
    expect(result).toContain('123 Main St');
    expect(result).toContain('latitude');
  });

  it('ignores __NEXT_DATA__ without location keywords', () => {
    const html = `
      <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":{"products":[{"name":"Widget"}]}}}
      </script>
    `;
    expect(extractEmbeddedLocationData(html)).toBe('');
  });

  it('extracts from application/json script blocks', () => {
    const html = `
      <script type="application/json">
      {"branches":[{"addressLocality":"Cork","postalCode":"T12"}]}
      </script>
    `;
    const result = extractEmbeddedLocationData(html);
    expect(result).toContain('addressLocality');
    expect(result).toContain('Cork');
  });

  it('ignores tiny application/json blocks (<30 chars)', () => {
    const html = '<script type="application/json">{"a":1}</script>';
    expect(extractEmbeddedLocationData(html)).toBe('');
  });

  it('ignores oversized application/json blocks (>50000 chars)', () => {
    const big = JSON.stringify({ streetAddress: 'x'.repeat(60000) });
    const html = `<script type="application/json">${big}</script>`;
    expect(extractEmbeddedLocationData(html)).toBe('');
  });

  it('extracts inline window.__DATA__ assignments with location keywords', () => {
    const html = `
      <script>
      window.__INITIAL_STATE__ = {"clinic":{"latitude":53.3,"longitude":-6.2}};
      </script>
    `;
    const result = extractEmbeddedLocationData(html);
    expect(result).toContain('latitude');
  });

  it('skips inline assignments that are not valid JSON', () => {
    const html = `
      <script>
      window.__DATA__ = {address: "not quoted keys"};
      </script>
    `;
    // This is not valid JSON, so should be skipped
    expect(extractEmbeddedLocationData(html)).toBe('');
  });

  it('caps total output at 4000 chars', () => {
    const bigProps = JSON.stringify({
      streetAddress: 'A'.repeat(5000),
      latitude: 53,
    });
    const html = `
      <script id="__NEXT_DATA__" type="application/json">
      {"props":{"pageProps":${bigProps}}}
      </script>
    `;
    const result = extractEmbeddedLocationData(html);
    expect(result.length).toBeLessThanOrEqual(4000);
  });

  it('handles malformed __NEXT_DATA__ gracefully', () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{broken json</script>';
    expect(extractEmbeddedLocationData(html)).toBe('');
  });

  it('returns empty string when no embedded data found', () => {
    expect(extractEmbeddedLocationData('<html><body>Plain</body></html>')).toBe(
      ''
    );
  });
});
