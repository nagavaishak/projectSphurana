import { describe, expect, it } from '@borradh-workspace/testing';
import {
  extractInternalLinks,
  extractLocationSubpageLinks,
  extractNavLinks,
  pickLocationUrls,
  resolveUrl,
} from './url-utilities.js';

describe('resolveUrl', () => {
  it('returns absolute URLs unchanged', () => {
    expect(resolveUrl('https://example.com/page', 'https://base.com')).toBe(
      'https://example.com/page'
    );
  });

  it('returns http URLs unchanged', () => {
    expect(resolveUrl('http://example.com/page', 'https://base.com')).toBe(
      'http://example.com/page'
    );
  });

  it('resolves relative URLs against base', () => {
    expect(resolveUrl('/about', 'https://example.com')).toBe(
      'https://example.com/about'
    );
  });

  it('resolves relative paths without leading slash', () => {
    expect(resolveUrl('about', 'https://example.com/page/')).toBe(
      'https://example.com/page/about'
    );
  });

  it('returns original URL if resolution fails', () => {
    expect(resolveUrl(':::invalid', '')).toBe(':::invalid');
  });
});

describe('pickLocationUrls', () => {
  const base = 'https://example.com';

  it('picks /locations URLs with highest priority', () => {
    const urls = [
      'https://example.com/about',
      'https://example.com/locations',
      'https://example.com/blog',
    ];
    const result = pickLocationUrls(urls, base);
    // /locations has higher priority than /about (which also matches)
    expect(result[0]).toBe('https://example.com/locations');
    // /about matches the contact/about pattern at lower priority
    expect(result).toContain('https://example.com/about');
  });

  it('picks /clinic and /branches URLs', () => {
    const urls = [
      'https://example.com/clinics',
      'https://example.com/branches',
    ];
    const result = pickLocationUrls(urls, base);
    expect(result).toHaveLength(2);
    expect(result).toContain('https://example.com/clinics');
    expect(result).toContain('https://example.com/branches');
  });

  it('picks /contact and /about as lower priority', () => {
    const urls = [
      'https://example.com/contact',
      'https://example.com/locations',
    ];
    const result = pickLocationUrls(urls, base);
    // /locations should come first (higher priority)
    expect(result[0]).toBe('https://example.com/locations');
  });

  it('returns at most 2 URLs', () => {
    const urls = [
      'https://example.com/locations',
      'https://example.com/clinics',
      'https://example.com/branches',
    ];
    expect(pickLocationUrls(urls, base)).toHaveLength(2);
  });

  it('excludes the homepage itself', () => {
    const urls = ['https://example.com/', 'https://example.com/locations'];
    const result = pickLocationUrls(urls, base);
    expect(result).toEqual(['https://example.com/locations']);
  });

  it('excludes external URLs', () => {
    const urls = [
      'https://external.com/locations',
      'https://example.com/locations',
    ];
    const result = pickLocationUrls(urls, base);
    expect(result).toEqual(['https://example.com/locations']);
  });

  it('prefers locale-matching URLs when homepage has locale prefix', () => {
    const localeBase = 'https://example.com/ie';
    const urls = [
      'https://example.com/locations', // no locale prefix
      'https://example.com/ie/locations', // matches locale
    ];
    const result = pickLocationUrls(urls, localeBase);
    expect(result[0]).toBe('https://example.com/ie/locations');
  });

  it('deduplicates by pathname', () => {
    // Both resolve to the same path after trailing slash stripping
    const urls = [
      'https://example.com/locations',
      'https://example.com/locations?q=1', // same pathname, different query
    ];
    const result = pickLocationUrls(urls, base);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when no location URLs found', () => {
    const urls = ['https://example.com/blog', 'https://example.com/shop'];
    expect(pickLocationUrls(urls, base)).toEqual([]);
  });

  it('skips malformed URLs', () => {
    const urls = ['not a url', 'https://example.com/locations'];
    const result = pickLocationUrls(urls, base);
    expect(result).toEqual(['https://example.com/locations']);
  });

  it('handles /find-us pattern', () => {
    const urls = ['https://example.com/find-us'];
    const result = pickLocationUrls(urls, base);
    expect(result).toEqual(['https://example.com/find-us']);
  });
});

describe('extractInternalLinks', () => {
  const base = 'https://example.com';

  it('extracts internal <a> links', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    `;
    const result = extractInternalLinks(html, base);
    expect(result).toContain('https://example.com/about');
    expect(result).toContain('https://example.com/contact');
  });

  it('skips mailto, tel, and javascript links', () => {
    const html = `
      <a href="mailto:test@test.com">Email</a>
      <a href="tel:+353123456">Call</a>
      <a href="javascript:void(0)">JS</a>
      <a href="/real-page">Real</a>
    `;
    const result = extractInternalLinks(html, base);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://example.com/real-page');
  });

  it('skips file extensions (pdf, jpg, etc.)', () => {
    const html = `
      <a href="/doc.pdf">PDF</a>
      <a href="/photo.jpg">Photo</a>
      <a href="/real">Real</a>
    `;
    const result = extractInternalLinks(html, base);
    expect(result).toHaveLength(1);
  });

  it('skips external links', () => {
    const html = `
      <a href="https://other.com/page">External</a>
      <a href="/internal">Internal</a>
    `;
    const result = extractInternalLinks(html, base);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://example.com/internal');
  });

  it('deduplicates by pathname', () => {
    const html = `
      <a href="/about">About 1</a>
      <a href="/about">About 2</a>
    `;
    expect(extractInternalLinks(html, base)).toHaveLength(1);
  });

  it('caps at 100 links', () => {
    const links = Array.from(
      { length: 150 },
      (_, i) => `<a href="/page-${i}">Page ${i}</a>`
    ).join('');
    expect(extractInternalLinks(links, base)).toHaveLength(100);
  });

  it('resolves relative URLs', () => {
    const html = '<a href="/about">About</a>';
    const result = extractInternalLinks(html, base);
    expect(result[0]).toBe('https://example.com/about');
  });

  it('returns empty array for HTML with no links', () => {
    expect(extractInternalLinks('<p>No links</p>', base)).toEqual([]);
  });
});

describe('extractNavLinks', () => {
  const base = 'https://example.com';

  it('extracts links from <nav> elements', () => {
    const html = `
      <nav>
        <a href="/services">Services</a>
        <a href="/about">About</a>
      </nav>
    `;
    const result = extractNavLinks(html, base);
    expect(result).toContain('https://example.com/services');
    expect(result).toContain('https://example.com/about');
  });

  it('extracts links from <header> elements', () => {
    const html = `
      <header>
        <a href="/home">Home</a>
        <a href="/contact">Contact</a>
      </header>
    `;
    const result = extractNavLinks(html, base);
    // /home is same as homepage, should be excluded
    expect(result).toContain('https://example.com/contact');
  });

  it('excludes homepage path', () => {
    const html = `
      <nav>
        <a href="/">Home</a>
        <a href="/about">About</a>
      </nav>
    `;
    const result = extractNavLinks(html, base);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://example.com/about');
  });

  it('ignores links outside nav/header', () => {
    const html = `
      <nav><a href="/nav-link">Nav</a></nav>
      <main><a href="/body-link">Body</a></main>
    `;
    const result = extractNavLinks(html, base);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe('https://example.com/nav-link');
  });

  it('deduplicates by pathname', () => {
    const html = `
      <nav><a href="/about">Nav About</a></nav>
      <header><a href="/about">Header About</a></header>
    `;
    expect(extractNavLinks(html, base)).toHaveLength(1);
  });
});

describe('extractLocationSubpageLinks', () => {
  it('extracts direct child links', () => {
    const html = `
      <a href="https://example.com/locations/dundrum">Dundrum</a>
      <a href="https://example.com/locations/stillorgan">Stillorgan</a>
    `;
    const result = extractLocationSubpageLinks(
      html,
      'https://example.com/locations'
    );
    expect(result).toHaveLength(2);
  });

  it('ignores non-child links (deeper nesting)', () => {
    const html = `
      <a href="https://example.com/locations/dublin/dundrum">Deep</a>
      <a href="https://example.com/locations/dundrum">Direct</a>
    `;
    const result = extractLocationSubpageLinks(
      html,
      'https://example.com/locations'
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('/dundrum');
  });

  it('returns empty for root path', () => {
    const html = '<a href="https://example.com/about">About</a>';
    expect(extractLocationSubpageLinks(html, 'https://example.com')).toEqual(
      []
    );
  });

  it('respects limit parameter', () => {
    const links = Array.from(
      { length: 10 },
      (_, i) => `<a href="https://example.com/locations/loc-${i}">Loc ${i}</a>`
    ).join('');
    expect(
      extractLocationSubpageLinks(links, 'https://example.com/locations', 3)
    ).toHaveLength(3);
  });

  it('handles trailing slashes on page URL', () => {
    const html = '<a href="https://example.com/locations/dundrum">Dundrum</a>';
    const result = extractLocationSubpageLinks(
      html,
      'https://example.com/locations/'
    );
    expect(result).toHaveLength(1);
  });
});
