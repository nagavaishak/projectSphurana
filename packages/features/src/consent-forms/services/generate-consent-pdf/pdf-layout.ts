/**
 * Pure layout helpers for the consent-form PDF (unit-tested directly —
 * the composed document is only smoke-tested for pages + bytes).
 */

/**
 * Substitute the {{patientName}} placeholder in template copy, exactly as the
 * portal signing screen does — the archived PDF must read identically to what
 * the patient attested to, never with a raw template token. The signer's own
 * name is authoritative (it is what the footer records); a blank/absent name
 * falls back to a neutral noun so an unsigned/info-only form never renders an
 * empty "I, , consent".
 */
export function interpolatePatientName(
  text: string,
  signedByName: string | null | undefined
): string {
  const name = signedByName?.trim() || 'the patient';
  return text.replaceAll('{{patientName}}', name);
}

/**
 * pdf-lib's standard fonts encode WinAnsi only — an emoji or exotic glyph in
 * a template body would throw mid-compose. Map the common typographic
 * characters to ASCII, then drop anything outside Latin-1.
 */
export function sanitizePdfText(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\n\x20-\x7E¡-ÿ]/g, '');
}

/**
 * Wrap a single paragraph (no newlines) to `maxWidth`, measuring with the
 * injected `measure` (font.widthOfTextAtSize in production, a char-count
 * stub in tests). Words longer than the line are hard-broken by character
 * so no input can force a zero-progress loop.
 */
export function wrapParagraph(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  const words = text.split(/ +/).filter((w) => w.length > 0);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let current = '';

  const pushWord = (word: string) => {
    const candidate = current ? `${current} ${word}` : word;
    if (measure(candidate) <= maxWidth) {
      current = candidate;
      return;
    }
    if (current) {
      lines.push(current);
      current = '';
    }
    // The word alone fits on a fresh line, or must be hard-broken.
    if (measure(word) <= maxWidth) {
      current = word;
      return;
    }
    let chunk = '';
    for (const char of word) {
      if (chunk && measure(chunk + char) > maxWidth) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    current = chunk;
  };

  for (const word of words) pushWord(word);
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

/**
 * Wrap multi-line text: newlines are respected (a blank source line stays a
 * blank output line), each paragraph wraps independently.
 */
export function wrapMultiline(
  text: string,
  maxWidth: number,
  measure: (s: string) => number
): string[] {
  return text
    .split('\n')
    .flatMap((paragraph) =>
      paragraph.trim() === ''
        ? ['']
        : wrapParagraph(paragraph, maxWidth, measure)
    );
}

/** Scale (w, h) to fit inside (maxWidth, maxHeight), preserving aspect. */
export function fitImage(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return { width: width * scale, height: height * scale };
}

/**
 * Format the signed-at timestamp in the org's timezone. Falls back to UTC if
 * the stored IANA name is invalid — the PDF must never fail on a bad tz.
 */
export function formatSignedAt(date: Date, timezone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  try {
    return new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      ...options,
      timeZone: 'UTC',
    }).format(date);
  }
}

export interface CursorPage {
  /** Index of the page the cursor sits on (0-based). */
  pageIndex: number;
  /** Current baseline y (PDF coords: measured from the bottom edge). */
  y: number;
}

/**
 * Minimal top-down pagination cursor. Pages are addressed by index so the
 * math is testable without pdf-lib: `take(height)` returns where the block
 * lands and whether a new page had to be opened first.
 */
export function createPageCursor(options: {
  pageHeight: number;
  marginTop: number;
  marginBottom: number;
}) {
  const { pageHeight, marginTop, marginBottom } = options;
  let pageIndex = 0;
  let y = pageHeight - marginTop;

  return {
    /** Reserve vertical space; opens a new page when the block won't fit. */
    take(height: number): CursorPage & { newPage: boolean } {
      let newPage = false;
      if (y - height < marginBottom && y < pageHeight - marginTop) {
        pageIndex += 1;
        y = pageHeight - marginTop;
        newPage = true;
      }
      const at = { pageIndex, y, newPage };
      y -= height;
      return at;
    },
    /** Add a fixed gap (no page break — gaps at a page top are dropped). */
    gap(height: number): void {
      if (y < pageHeight - marginTop) y -= height;
    },
    get position(): CursorPage {
      return { pageIndex, y };
    },
  };
}
