import type { Locator, Page } from '@playwright/test';
import { isVisibleWithin } from './wait.js';

/**
 * Date fields in apps/app are `DatePicker` (a popover-triggering button + a
 * react-day-picker calendar), not `<input type="date">` — `.fill()` throws on
 * them. Drive them through the calendar instead.
 */

const ordinal = (day: number): string => {
  const mod10 = day % 10;
  const mod100 = day % 100;
  if (mod10 === 1 && mod100 !== 11) return `${day}st`;
  if (mod10 === 2 && mod100 !== 12) return `${day}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${day}rd`;
  return `${day}th`;
};

/**
 * The aria-label react-day-picker puts on each day button: date-fns `PPPP`,
 * e.g. "Sunday, July 12th, 2026". It also prefixes "Today, " and suffixes
 * ", selected", so callers match it as a substring.
 */
const dayButtonLabel = (date: Date): string => {
  const weekday = date.toLocaleDateString('en-US', { weekday: 'long' });
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  return `${weekday}, ${month} ${ordinal(date.getDate())}, ${date.getFullYear()}`;
};

/**
 * Pick `date` in the `DatePicker` labelled `label` inside `scope` (a dialog,
 * form, or the page). Opens the popover, pages the calendar forward to the
 * target month if needed, and clicks the day.
 */
export async function pickDate(
  page: Page,
  scope: Locator | Page,
  label: string,
  date: Date
): Promise<void> {
  await scope.getByLabel(label, { exact: true }).click();

  // The popover portals to <body>, so it is outside `scope`. Identify it by the
  // calendar's month-nav button rather than a generic [role=dialog].
  const calendar = page
    .locator('[data-slot="popover-content"]')
    .filter({ has: page.getByRole('button', { name: 'Go to the Next Month' }) })
    .last();
  await calendar.waitFor({ state: 'visible', timeout: 10_000 });

  const day = calendar.getByRole('button', {
    name: dayButtonLabel(date),
    exact: false,
  });

  // The calendar opens on the selected month (today's, when empty); a target a
  // few days out can land in the next month.
  for (let i = 0; i < 12; i++) {
    // A real wait: the month grid re-renders after each nav click, so a
    // non-waiting probe would page straight past the target month.
    if (await isVisibleWithin(day, 1_000)) break;
    await calendar
      .getByRole('button', { name: 'Go to the Next Month' })
      .click();
  }

  // CRITICAL: react-day-picker's single mode TOGGLES. Clicking the day that is
  // already selected fires `onSelect(undefined)`, which the DatePicker writes
  // back as `''` — so a naive click would CLEAR a date the form had already
  // defaulted to (every schedule form defaults to today, and callers schedule
  // for today). When the target is already selected, just close the popover.
  const isSelected = await isVisibleWithin(
    calendar.getByRole('button', {
      name: `${dayButtonLabel(date)}, selected`,
      exact: false,
    }),
    1_000
  );

  if (isSelected) {
    await page.keyboard.press('Escape');
  } else {
    await day.click();
  }

  await calendar.waitFor({ state: 'hidden', timeout: 10_000 });
}
