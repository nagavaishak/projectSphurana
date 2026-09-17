import type { ApplyModes, WebsiteAnalysisPlan } from '../../api/types';

/**
 * Pseudo-keys for the three sections that are a single VALUE rather than a list
 * of rows. They tick like any other row but resolve to a section mode, not to a
 * `deselected` entry. Namespaced so they can never collide with a real plan key
 * (`service.*`, `package.*`, `team.*`, `location.*`).
 */
export const VALUE_KEYS = {
  description: 'value.description',
  hours: 'value.hours',
  brand: 'value.brand',
} as const;

/** Rows that ADD or CHANGE something — ticked by default. */
export const additiveKeys = (plan: WebsiteAnalysisPlan): string[] => [
  ...plan.services.create.map((r) => r.key),
  ...plan.services.priceChanges.map((r) => r.key),
  ...plan.packages.create.map((r) => r.key),
  ...plan.team.create.map((r) => r.key),
  ...plan.locations.create.map((r) => r.key),
];

/**
 * Rows that SWITCH SOMETHING OFF — never ticked by default.
 *
 * Deactivating a service because the website stopped listing it is the one
 * genuinely lossy thing an apply can do (it drops out of the catalog, the
 * booking page and every picker), and a site being reorganised is a far more
 * common reason for a service to go missing than the clinic dropping it. So
 * this is opt-in, one row at a time.
 */
export const deactivateKeys = (plan: WebsiteAnalysisPlan): string[] => [
  ...plan.services.notFound.map((r) => r.key),
  ...plan.packages.notFound.map((r) => r.key),
  ...plan.team.notFound.map((r) => r.key),
];

/** Value sections the scan actually produced something for. */
export const availableValueKeys = (plan: WebsiteAnalysisPlan): string[] => {
  const keys: string[] = [];
  if (plan.scanned.includes('description') && plan.description.scanned) {
    keys.push(VALUE_KEYS.description);
  }
  if (plan.scanned.includes('hours') && plan.hours.scanned) {
    keys.push(VALUE_KEYS.hours);
  }
  if (
    plan.scanned.includes('brand') &&
    (plan.brand.scanned.primaryColor || plan.brand.scanned.logoUrl)
  ) {
    keys.push(VALUE_KEYS.brand);
  }
  return keys;
};

/** Every row the owner can tick, in one set — used for "select all" and counts. */
export const allSelectableKeys = (plan: WebsiteAnalysisPlan): string[] => [
  ...additiveKeys(plan),
  ...deactivateKeys(plan),
  ...availableValueKeys(plan),
];

/** The tick state a freshly-previewed plan opens with. */
export const defaultSelection = (plan: WebsiteAnalysisPlan): Set<string> =>
  new Set([...additiveKeys(plan), ...availableValueKeys(plan)]);

/**
 * Every actionable row carries a server-issued key.
 *
 * A frontend that is briefly AHEAD of the API — a rolling deploy, a preview
 * whose app rebuilt before its api did — receives rows with no `key` at all.
 * Every checkbox then collapses onto the same identity and one click toggles
 * the entire plan, while the older API ignores `deselected` and writes the rows
 * the owner just un-ticked. Both failures are silent.
 *
 * This is the screen that promises the owner exactly what will change, so the
 * only honest response is to refuse the review rather than offer a broken one.
 */
export const hasStableKeys = (plan: WebsiteAnalysisPlan): boolean =>
  [...additiveKeys(plan), ...deactivateKeys(plan)].every(
    (key) => typeof key === 'string' && key.length > 0
  );

/** Nothing to show at all — the account already matches the website. */
export const isNoOpPlan = (plan: WebsiteAnalysisPlan): boolean =>
  allSelectableKeys(plan).length === 0 &&
  plan.packages.blocked.length === 0 &&
  plan.locations.blocked.length === 0;

/**
 * Turn the ticks into the two things the API takes.
 *
 * `modes` gates a whole section; `deselected` drops individual rows within it.
 * A section whose rows are ALL unticked resolves to `ignore` rather than to a
 * complete deselection — same outcome, but it keeps the request honest about
 * intent and skips the work server-side.
 *
 * `replace` is derived, never chosen: it is simply what "at least one switch-off
 * row is ticked" means. That is why the review step has no Add/Replace/Ignore
 * control — there was never a decision there that the ticks don't already make.
 */
export const buildApplyInput = (
  plan: WebsiteAnalysisPlan,
  selected: ReadonlySet<string>
): { modes: Partial<ApplyModes>; deselected: string[] } => {
  const listMode = (
    additive: readonly { key: string }[],
    deactivate: readonly { key: string }[]
  ): 'add' | 'replace' | 'ignore' => {
    const anyDeactivate = deactivate.some((r) => selected.has(r.key));
    if (anyDeactivate) return 'replace';
    return additive.some((r) => selected.has(r.key)) ? 'add' : 'ignore';
  };

  const modes: Partial<ApplyModes> = {
    services: listMode(
      [...plan.services.create, ...plan.services.priceChanges],
      plan.services.notFound
    ),
    packages: listMode(plan.packages.create, plan.packages.notFound),
    team: listMode(plan.team.create, plan.team.notFound),
    locations: plan.locations.create.some((r) => selected.has(r.key))
      ? 'add'
      : 'ignore',
    description: selected.has(VALUE_KEYS.description) ? 'apply' : 'ignore',
    hours: selected.has(VALUE_KEYS.hours) ? 'apply' : 'ignore',
    brand: selected.has(VALUE_KEYS.brand) ? 'apply' : 'ignore',
  };

  // Every real plan row that is not ticked. Rows in an `ignore`d section are
  // included too — redundant, but harmless, and it means this stays correct if
  // the mode derivation above ever changes.
  const deselected = [...additiveKeys(plan), ...deactivateKeys(plan)].filter(
    (key) => !selected.has(key)
  );

  return { modes, deselected };
};

/** How many rows are ticked, for the header and the Apply button. */
export const selectedCount = (
  plan: WebsiteAnalysisPlan,
  selected: ReadonlySet<string>
): number => allSelectableKeys(plan).filter((k) => selected.has(k)).length;
