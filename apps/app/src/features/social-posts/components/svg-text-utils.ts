const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Measure the rendered width of a text string using a temporary SVG text element.
 * The SVG must be in the DOM for getComputedTextLength() to work.
 */
export function measureSvgTextWidth(
  svg: SVGSVGElement,
  text: string,
  fontFamily: string,
  fontSize: string,
  fontWeight?: string
): number {
  const el = document.createElementNS(SVG_NS, 'text');
  el.setAttribute('font-family', fontFamily);
  el.setAttribute('font-size', fontSize);
  if (fontWeight) el.setAttribute('font-weight', fontWeight);
  el.style.visibility = 'hidden';
  el.textContent = text;
  svg.appendChild(el);
  const width = el.getComputedTextLength();
  svg.removeChild(el);
  return width;
}

/**
 * Word-wrap text into lines that fit within the given max width.
 * Supports explicit newlines (\n) and optional reduced first-line width
 * (useful when an inline bold username precedes the text on the first line).
 */
export function wrapTextIntoLines(
  svg: SVGSVGElement,
  text: string,
  maxWidth: number,
  fontFamily: string,
  fontSize: string,
  fontWeight?: string,
  firstLineMaxWidth?: number
): string[] {
  if (!text.trim()) return [''];

  const paragraphs = text.split('\n');
  const allLines: string[] = [];

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) {
      allLines.push('');
      continue;
    }

    const words = paragraph.split(/\s+/).filter(Boolean);
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const effectiveMaxWidth =
        allLines.length === 0 && firstLineMaxWidth !== undefined
          ? firstLineMaxWidth
          : maxWidth;

      const width = measureSvgTextWidth(
        svg,
        testLine,
        fontFamily,
        fontSize,
        fontWeight
      );

      if (width > effectiveMaxWidth && currentLine) {
        allLines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }

    if (currentLine) allLines.push(currentLine);
  }

  return allLines.length > 0 ? allLines : [''];
}

/**
 * Wrap all following siblings of the given element in a translated <g> group,
 * effectively shifting all content after it by (0, deltaY).
 */
export function shiftFollowingSiblings(
  referenceEl: Element,
  deltaY: number
): void {
  const parent = referenceEl.parentElement;
  if (!parent) return;

  const siblings: Element[] = [];
  let next = referenceEl.nextElementSibling;
  while (next) {
    siblings.push(next);
    next = next.nextElementSibling;
  }

  if (siblings.length === 0) return;

  const wrapper = document.createElementNS(SVG_NS, 'g');
  wrapper.setAttribute('transform', `translate(0, ${deltaY})`);
  parent.insertBefore(wrapper, referenceEl.nextSibling);
  for (const s of siblings) {
    wrapper.appendChild(s);
  }
}
