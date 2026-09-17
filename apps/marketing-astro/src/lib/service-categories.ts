/**
 * The category chips shown above a public service list, in catalogue order.
 *
 * Returns an EMPTY array when chips would not earn their place, which is the
 * common case: 72 of 101 orgs with a live catalogue have nothing categorised.
 * A row of chips that every service matches is worse than no row — it looks
 * like a filter, and clicking it changes nothing.
 *
 * Chips are worth showing when they actually split the list:
 *   - two or more categories, or
 *   - exactly one category PLUS services that sit outside it (so the chip
 *     narrows to a real subset and "All" means something).
 *
 * `category` is the org's own category name or null; it is never the legacy
 * `organization_service.category` enum, whose 'treatment' default used to
 * manufacture one chip that matched everything.
 */
export function serviceCategoryChips(
  services: readonly { category?: string | null }[]
): string[] {
  const inOrder: string[] = [];
  let uncategorised = false;

  for (const service of services) {
    const category = service.category;
    if (!category) {
      uncategorised = true;
      continue;
    }
    if (!inOrder.includes(category)) inOrder.push(category);
  }

  if (inOrder.length === 0) return [];
  if (inOrder.length === 1 && !uncategorised) return [];
  return inOrder;
}
