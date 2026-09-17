import type { FieldSpecMap } from '@/lib/form-contract/define-form';
import {
  type FieldEntry,
  type FieldMeta,
  fillableFields,
  isExempt,
} from '@/lib/form-contract/fields';
import { cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { FormContract } from './contract';
import { driverFor } from './drivers';
import { requiredKeysAcrossBranches } from './schema-keys';

/**
 * THE form harness. One registry, one set of properties, one report.
 *
 * It replaces five separate CI gates — a defaults checker, a coverage ratchet,
 * two source-text rules and ~15 hand-written per-form parity specs — each of
 * which caught one thing and none of which said what the others were for. They
 * were all asserting the same property in different clothes: A FORM'S UI, ITS
 * SCHEMA, AND ITS PAYLOAD AGREE.
 *
 * With `defineForm`, most of that is now unspellable rather than tested: a field
 * cannot be declared without a default (the old defaults gate), and cannot be
 * declared without a label the component renders (which is what makes a dropped
 * control detectable at all). What remains is what a compiler cannot see, and
 * that is what this checks:
 *
 *   1. DEFAULTS COMPLETE — backstop. Every key the schema can require, across
 *      ALL union branches, is seeded.
 *   2. FIELDS REACHABLE  — every declared field has a control on screen.
 *   3. PAYLOAD CORRECT   — fill everything, submit, assert the exact body.
 *   4. SURFACES AGREE    — the same recipe on every surface builds one body.
 *
 * Every failure names its property, so a red run says what broke, not just that
 * something did.
 */

const PROP = {
  defaults: 'PROPERTY 1 (defaults complete)',
  reachable: 'PROPERTY 2 (fields reachable)',
  payload: 'PROPERTY 3 (payload correct)',
  parity: 'PROPERTY 4 (surfaces agree)',
  minimum: 'PROPERTY 5 (minimum fill valid)',
} as const;

/** Every empty-or-whitespace string in a body, as dotted paths. */
function blankPaths(value: unknown, path = ''): string[] {
  if (typeof value === 'string') {
    return value.trim() === '' ? [path || '(root)'] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => blankPaths(v, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([k, v]) =>
      blankPaths(v, path ? `${path}.${k}` : k)
    );
  }
  return [];
}

/**
 * The values a user produces when they fill only what the form makes them fill:
 * the declared defaults, with a sample substituted for each field the schema
 * refuses to accept blank.
 *
 * Derived from the form's OWN schema rather than a hand-listed "required" set,
 * so it cannot drift from what the UI actually enforces, and it follows a
 * discriminated union into whichever branch the defaults start in.
 */
function minimumValues<F extends FieldSpecMap, V extends object>(
  form: NonNullable<FormContract<F, V>['form']>
): V {
  const registry = form.fields as Record<string, FieldEntry>;
  const values = { ...(form.defaults as Record<string, unknown>) };

  // Each pass fixes the fields the schema is currently complaining about;
  // filling one branch key can reveal another, so iterate to a fixed point.
  for (let pass = 0; pass < 10; pass++) {
    const result = form.schema.safeParse(values);
    if (result.success) break;

    let changed = false;
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '');
      const entry = registry[key];
      if (!entry || isExempt(entry)) continue;
      const sample = (entry as FieldMeta).sample;
      if (sample === undefined || values[key] === sample) continue;
      values[key] = sample;
      changed = true;
    }
    if (!changed) break;
  }

  return values as V;
}

export function runFormContract<F extends FieldSpecMap, V extends object>(
  contract: FormContract<F, V>
): void {
  const { operation, description, form, surfaces } = contract;
  const registry = (form?.fields ?? {}) as Record<string, FieldEntry>;
  const fillableKeys = fillableFields(registry).map(([key]) => key);

  /** The fields each surface is responsible for (all of them, unless declared). */
  const ownedBy = (surface: (typeof surfaces)[number]): string[] =>
    surface.owns ? [...surface.owns] : fillableKeys;

  /** Bodies captured per surface — shared by properties 3 and 4. */
  const bodies = new Map<string, Record<string, unknown>>();

  describe(`form contract — ${operation} (${description})`, () => {
    beforeEach(() => contract.reset());
    afterEach(() => cleanup());

    if (!form && !contract.noForm) {
      throw new Error(
        `${operation}: a contract with no \`form\` must say why in \`noForm\`. Properties 1 and 2 are skipped for it, so the reason is read in review.`
      );
    }

    // ---------------------------------------------------------------- prop 1
    it.skipIf(!form)(
      `${PROP.defaults}: every key the schema can require is seeded`,
      () => {
        const f = form as NonNullable<typeof form>;
        const defaults = f.defaults as Record<string, unknown>;
        const required = requiredKeysAcrossBranches(f.schema);
        const missing = [...required].filter((k) => defaults[k] === undefined);

        expect(
          missing,
          `${PROP.defaults} — ${operation}\n\nThese keys can be REQUIRED by the schema but are undefined in the form's defaults:\n${missing.map((k) => `  - ${k}`).join('\n')}\n\nreact-hook-form then holds no state for them, so submit sends \`undefined\` and zod\nreports a type error ("expected string, received undefined") against a field the\nuser believes is filled in — invisible in the UI, unfixable by them.\n\nA key can be optional in the branch the form STARTS in and required in another\n(a discriminated union on mode/type), which is exactly how this shipped — so this\nchecks the union across ALL branches, not just the default one.\n\nIf the form is built with defineForm this should be impossible: \`default\` is a\nrequired property whose type excludes undefined. Reaching this means the defaults\nwere assembled somewhere else — move them into the field declarations.`
        ).toEqual([]);
      }
    );

    // A PATCH whose surfaces own different slices is still not allowed to let a
    // field fall off ALL of them. That is the dropped-field bug wearing a hat.
    if (surfaces.some((s) => s.owns)) {
      it(`${PROP.reachable}: every field is owned by at least one surface`, () => {
        const owned = new Set(surfaces.flatMap(ownedBy));
        const orphaned = fillableKeys.filter((k) => !owned.has(k));
        expect(
          orphaned,
          `${PROP.reachable} — ${operation}\n\nThese fields are declared but NO surface claims to own them:\n${orphaned.map((k) => `  - ${k}`).join('\n')}\n\nThe user cannot produce them anywhere in the app, yet the schema and the\npayload builder still carry them. Surface ownership narrows WHICH surface must\nrender a field — it must never make a field render nowhere.`
        ).toEqual([]);
      });
    }

    // ------------------------------------------------------------ props 2 + 3
    // One drive of each surface serves both: filling proves reachability, and the
    // body it produces proves correctness. These render real component trees, so
    // we drive each surface once rather than once per property.
    for (const surface of surfaces) {
      it(`${PROP.reachable} + ${PROP.payload}: ${surface.name}`, async () => {
        // `delay: null` types synchronously instead of awaiting a macrotask
        // between keystrokes. These specs drive whole real forms — the desktop
        // blocked-time surface alone took ~14.5s on an idle machine against the
        // 30s timeout, so under the full `turbo test` fan-out (every package's
        // vitest pool competing for the same cores) it intermittently blew the
        // limit. The failing surface varied run to run, which is the signature
        // of contention rather than a real defect. Removing the per-keystroke
        // yield restores the margin.
        const user = userEvent.setup({ delay: null });
        const filled = new Set<string>();

        const fillOne = async (key: string) => {
          const entry = registry[key];
          if (!entry) {
            throw new Error(
              `${operation} / ${surface.name}: no field "${key}" is declared — the surface asked to fill a key that does not exist.`
            );
          }
          if (isExempt(entry)) {
            throw new Error(
              `${operation} / ${surface.name}: field "${key}" is exempt (${entry.why}); the surface must not try to fill it.`
            );
          }

          const field = entry as FieldMeta;
          const override =
            surface.fills?.[key as keyof F] ?? contract.fills?.[key as keyof F];
          const driver = driverFor(field.control);

          if (!override && !driver) {
            throw new Error(
              `${operation}: field "${key}" declares control '${field.control}' and the\ncontract supplies no \`fills.${key}\` override. A custom control must be\ndriven explicitly — it cannot be skipped, or a dropped control would go\nunnoticed, which is the whole point of ${PROP.reachable}.`
            );
          }

          try {
            if (override) await override(user);
            else await (driver as NonNullable<typeof driver>)(user, field, key);
          } catch (cause) {
            throw new Error(
              `${PROP.reachable} — ${operation} / ${surface.name}\n\nField "${key}" (label: "${field.label}") has NO REACHABLE CONTROL.\n\nThe field is still declared — so it is still in the schema and still mapped by\nthe payload builder — but the user has no way to produce a value for it. A\npayload-level test cannot see this: the builder still maps the field, and if\nevery surface shares the same broken panel, parity still holds. That is exactly\nhow the team-member Phone / Country code / Additional phone inputs were lost.\n\nIf the control was deleted by mistake, restore it. If the field is genuinely not\nmeant to be user-editable, declare it \`exempt('<why>')\`. But if the honest\nanswer is "the user can no longer set this", that is A BUG TO FIX, not a field\nto exempt.\n\nunderlying failure: ${(cause as Error).message}`,
              { cause }
            );
          }
          filled.add(key);
        };

        await surface.run({
          user,
          fill: async (...keys: string[]) => {
            for (const key of keys) await fillOne(key);
          },
          fillRest: async () => {
            for (const key of ownedBy(surface)) {
              if (!filled.has(key)) await fillOne(key);
            }
          },
        } as Parameters<typeof surface.run>[0]);

        // A field the surface never walked to is a field it proved nothing about.
        const unvisited = ownedBy(surface).filter((k) => !filled.has(k));
        expect(
          unvisited,
          `${PROP.reachable} — ${operation} / ${surface.name}\n\nThe surface reached submit without ever filling these fields it OWNS:\n${unvisited.map((k) => `  - ${k}`).join('\n')}\n\nEither its \`run\` never walks to the step that holds them (fix the run), or this\nsurface genuinely cannot set them — in which case it is not building the same\npayload as the others, and ${PROP.parity} is already broken.`
        ).toEqual([]);

        const body = contract.readBody();
        bodies.set(surface.name, body);

        expect(
          body,
          `${PROP.payload} — ${operation} / ${surface.name}\n\nThe body sent to the API is not what the filled form should produce.`
        ).toEqual(contract.expectedBody(surface));
      });
    }

    // ---------------------------------------------------------------- prop 5
    if (form && contract.buildBody) {
      it(`${PROP.minimum}: a required-only fill produces a valid wire body`, () => {
        const values = minimumValues(form);
        const build = contract.buildBody as NonNullable<
          typeof contract.buildBody
        >;

        let body: Record<string, unknown>;
        try {
          body = build(values);
        } catch (cause) {
          throw new Error(
            `${PROP.minimum} — ${operation}\n\nA user who filled ONLY the required fields cannot submit this form: the shared\npayload builder REJECTED the body it assembled from their input.\n\nAn untouched optional text input holds '' , not undefined, and '' is a PRESENT\nvalue — so the canonical request contract applies the field's rules to it. An\naddress field typed \`.email().optional()\` accepts an absent key and refuses an\nempty one. That is how POST /leads refused every client added without an email:\nthe wire body was assembled, sent, and 400'd with a bare "Validation failed"\nnaming no field.\n\nNormalise blank optional text to undefined in the builder so "not filled in"\nreaches the wire as ABSENCE. Properties 2-4 cannot see this — they fill every\nfield, and this only appears when one is left alone.\n\nbuilder error: ${(cause as Error).message}`,
            { cause }
          );
        }

        // Blank strings that the contract happens to tolerate are still wrong:
        // they persist "" as a phone number rather than recording no phone.
        const blanks = blankPaths(body);
        expect(
          blanks,
          `${PROP.minimum} — ${operation}\n\nThe body parsed, but a required-only fill still sends an empty string for:\n${blanks
            .map((path) => `  - ${path}`)
            .join(
              '\n'
            )}\n\nThese fields are loose enough to accept it today, so nothing 400s — but the\nrecord now says "this client's phone number is the empty string" rather than\n"this client has no phone number", and the next field to gain a format rule\nbecomes the next POST /leads. Drop blank optional text in the builder.`
        ).toEqual([]);
      });
    } else if (form) {
      it.skip(`${PROP.minimum}: a required-only fill produces a valid wire body — no \`buildBody\` on this contract`, () => {});
    }

    // ---------------------------------------------------------------- prop 4
    if (surfaces.length > 1) {
      it(`${PROP.parity}: all ${surfaces.length} surfaces build an identical body`, () => {
        const names = surfaces.map((s) => s.name);
        const absent = names.filter((n) => !bodies.has(n));

        expect(
          absent,
          `${PROP.parity} — ${operation}\n\nNo body was captured for: ${absent.join(', ')}.\nThose surfaces failed above; fix them first — parity between a working surface\nand a broken one is meaningless.`
        ).toEqual([]);

        // Surfaces that own different slices of a PATCH cannot send equal bodies —
        // that is the point of them. What they MUST agree on is the ground they
        // share: a field both render has to reach the wire the same way from both.
        for (let i = 0; i < surfaces.length; i++) {
          for (let j = i + 1; j < surfaces.length; j++) {
            const [a, b] = [surfaces[i], surfaces[j]];
            const shared = ownedBy(a).filter((k) => ownedBy(b).includes(k));
            const [bodyA, bodyB] = [bodies.get(a.name), bodies.get(b.name)];

            const slice = (
              body: Record<string, unknown> | undefined,
              keys: string[]
            ) =>
              Object.fromEntries(
                Object.entries(body ?? {}).filter(([k]) => keys.includes(k))
              );

            expect(
              slice(bodyB, shared),
              `${PROP.parity} — ${operation}\n\n"${b.name}" and "${a.name}" both let the user set ${shared.length ? shared.join(', ') : '(the whole body)'},\nbut they send it DIFFERENTLY for the same input.\n\nEvery surface must pass typed intent to the one shared payload builder; a\nsurface that assembles the body itself is how two surfaces drift.`
            ).toEqual(slice(bodyA, shared));
          }
        }
      });
    }
  });
}
