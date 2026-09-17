import type { FieldMeta } from '@/lib/form-contract/fields';
import { fireEvent, screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

/**
 * How the harness drives each control kind, given only the registry's `label`
 * and `sample`.
 *
 * Everything here locates BY LABEL OR ROLE — the way a user finds a control, and
 * the way a control that is no longer rendered makes itself known. A driver that
 * cannot find its control throws, and the harness turns that throw into
 * "PROPERTY 2: field unreachable".
 *
 * A form whose control is genuinely bespoke (an asset grid, a colour swatch
 * picker, a drag-to-reschedule calendar) declares `control: 'custom'` and the
 * contract spec hands the harness a `fill` override.
 */

export type Driver = (
  user: UserEvent,
  field: FieldMeta,
  key: string
) => Promise<void>;

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * What each control kind looks like in the DOM. Used to disambiguate when one
 * label names more than one control — which is normal and not a bug: the
 * create-lead form has an "Email" text input AND an "Email" consent checkbox,
 * and a user tells them apart by what they are, not just what they're called.
 */
const MATCHES: Record<string, (el: HTMLElement) => boolean> = {
  textbox: (el) =>
    (el.tagName === 'INPUT' && el.getAttribute('type') !== 'checkbox') ||
    el.tagName === 'TEXTAREA',
  checkbox: (el) =>
    el.getAttribute('role') === 'checkbox' ||
    (el as HTMLInputElement).type === 'checkbox',
  switch: (el) => el.getAttribute('role') === 'switch',
  trigger: (el) =>
    el.tagName === 'BUTTON' ||
    el.getAttribute('role') === 'combobox' ||
    el.getAttribute('aria-haspopup') !== null,
  group: (el) =>
    el.getAttribute('role') === 'radiogroup' || el.tagName === 'DIV',
};

/**
 * The control `label` names, of the kind we expect.
 *
 * Throws when there is none — which is the whole point: a control deleted from
 * the JSX while its field stays in the schema and the payload builder is exactly
 * the bug the harness exists to catch, and this is where it surfaces.
 */
const control = (label: string, kind: keyof typeof MATCHES): HTMLElement => {
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i');
  const all = screen.queryAllByLabelText(pattern);

  if (all.length === 0) {
    throw new Error(
      `no control labelled "${label}" is rendered ` +
        `(expected a ${kind}). The field is declared but the user cannot reach it.`
    );
  }

  const matching = all.filter((el) => MATCHES[kind](el as HTMLElement));
  if (matching.length === 1) return matching[0] as HTMLElement;
  if (matching.length === 0) {
    throw new Error(
      `"${label}" is rendered, but none of its ${all.length} control(s) is a ${kind} ` +
        `(found: ${all.map((el) => el.tagName.toLowerCase()).join(', ')}).`
    );
  }
  throw new Error(
    `"${label}" names ${matching.length} separate ${kind} controls, so the harness cannot tell which one the user means. Give them distinct labels — if a person can't tell them apart either, that is an accessibility bug worth fixing.`
  );
};

/** Set a value directly — for controls jsdom cannot be typed into (date/time). */
const setValue = async (el: HTMLElement, value: string): Promise<void> => {
  fireEvent.change(el, { target: { value } });
};

/**
 * Clear then type, so a pre-filled control lands on exactly `sample` — then
 * VERIFY it did.
 *
 * `clear()` takes the input through the empty string, and a react-hook-form field
 * whose empty state maps back to a non-empty default (a numeric input storing
 * `undefined`; a "notice period" that falls back to 24) is immediately
 * repopulated by RHF — so the keystrokes that follow APPEND to the old value.
 * Seeding 48 over a default of 24 silently produced `2448`, which then failed
 * HTML constraint validation, so the form never submitted and nothing on screen
 * said why. Three separate forms hit this before it was understood.
 *
 * Numeric fields now bypass this entirely (`number` sets the value outright). The
 * check below is the backstop for every other control: a driver that quietly
 * fills the wrong value would make the contract assert a wrong body, which is
 * worse than having no contract at all.
 */
const retype = async (user: UserEvent, el: HTMLElement, value: string) => {
  await user.clear(el);
  if (value !== '') await user.type(el, value);

  // The guard. If the control did not end up holding exactly what we typed, the
  // fallback above fired and we appended to a stale value instead of replacing
  // it. Fail loudly rather than submit a silently wrong body — a contract that
  // asserts the wrong payload is worse than no contract.
  const actual = (el as HTMLInputElement).value;
  if (actual !== value) {
    throw new Error(
      `typing "${value}" left the control holding "${actual}".\nreact-hook-form repopulated it from its default while it was momentarily empty, so the keystrokes appended. Declare this field \`control: 'number'\` (which sets the value outright) or give it a \`fills\` override.`
    );
  }
};

const asString = (value: unknown): string =>
  value === null || value === undefined ? '' : String(value);

/** The visible text of the option to pick — falls back to the stored value. */
const optionText = (field: FieldMeta): string =>
  field.sampleLabel ?? asString(field.sample);

const DRIVERS: Record<string, Driver> = {
  text: async (user, field) =>
    retype(user, control(field.label, 'textbox'), asString(field.sample)),
  textarea: async (user, field) =>
    retype(user, control(field.label, 'textbox'), asString(field.sample)),
  email: async (user, field) =>
    retype(user, control(field.label, 'textbox'), asString(field.sample)),
  tel: async (user, field) =>
    retype(user, control(field.label, 'textbox'), asString(field.sample)),
  // NOT clear-then-type. A controlled numeric input usually maps '' back to
  // `undefined`, so `clear()` leaves react-hook-form holding the OLD value, the
  // input snaps back to it, and the subsequent keystroke APPENDS: seeding 2 over
  // a default of 1 silently produced 12. Set the value outright instead.
  number: async (_user, field) =>
    setValue(control(field.label, 'textbox'), asString(field.sample)),
  // `<input type="date">` / `type="time"` cannot be typed into character by
  // character under jsdom — keystrokes land on the segment the caret happens to
  // be in and '10:00' comes out as '09:59'. Set the value the way the browser's
  // own picker does.
  date: async (_user, field) =>
    setValue(control(field.label, 'textbox'), asString(field.sample)),
  time: async (_user, field) =>
    setValue(control(field.label, 'textbox'), asString(field.sample)),

  /** Radix Select: click the trigger, then the option by its accessible name. */
  select: async (user, field) => {
    await user.click(control(field.label, 'trigger'));
    const option = await screen.findByRole('option', {
      name: new RegExp(`^\\s*${escapeRegExp(optionText(field))}\\s*$`, 'i'),
    });
    await user.click(option);
  },

  /** cmdk combobox: open, then pick the option. */
  combobox: async (user, field) => {
    await user.click(control(field.label, 'trigger'));
    const option = await screen.findByRole('option', {
      name: new RegExp(escapeRegExp(optionText(field)), 'i'),
    });
    await user.click(option);
  },

  checkbox: async (user, field) => {
    const box = control(field.label, 'checkbox');
    const state =
      box.getAttribute('aria-checked') ?? box.getAttribute('data-state');
    const isOn = state === 'true' || state === 'checked';
    if (isOn !== Boolean(field.sample)) await user.click(box);
  },

  switch: async (user, field) => {
    const toggle = control(field.label, 'switch');
    const isOn = toggle.getAttribute('data-state') === 'checked';
    if (isOn !== Boolean(field.sample)) await user.click(toggle);
  },

  /** Radio group: the option whose accessible name is `sampleLabel` / `sample`. */
  radio: async (user, field) => {
    const group = control(field.label, 'group');
    const option = within(group).getByRole('radio', {
      name: new RegExp(escapeRegExp(optionText(field)), 'i'),
    });
    await user.click(option);
  },

  /** Free-text tag input: type each tag, Enter between. */
  tags: async (user, field) => {
    const input = control(field.label, 'textbox');
    for (const tag of (field.sample as string[]) ?? []) {
      await user.type(input, `${tag}{Enter}`);
    }
  },
};

export function driverFor(kind: string): Driver | null {
  return DRIVERS[kind] ?? null;
}
