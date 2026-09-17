import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { REGISTERED_FORMS } from '../../test/form-contract/registry';
import './definitions/index';
import { entityEditorSlugs, getEntityEditor } from './registry';

/**
 * The gate on the unified create/edit editor.
 *
 * Every registered entity editor must have BOTH tiers of test:
 *
 *   1. a COMPONENT test that mounts the editor and drives its fields, at
 *      `definitions/<slug>.component.test.tsx`;
 *   2. an INTEGRATION/contract entry in the form-contract registry, which runs
 *      the shared harness and proves the five properties — including that the
 *      body actually POSTed matches the endpoint's schema.
 *
 * Neither substitutes for the other. A component test proves the form renders
 * and responds; only the contract proves the request is one the API accepts.
 * The `POST /leads` 400 that shipped because a blank optional was sent as `''`
 * instead of being omitted is the canonical example — it rendered perfectly.
 *
 * The source of truth is the RUNTIME registry, not a hand-kept list: register an
 * editor and forget its tests, and this goes red on the next run.
 */

const here = dirname(fileURLToPath(import.meta.url));
const definitionsDir = resolve(here, 'definitions');

/**
 * Slugs deliberately exempt from the component-test requirement, each with a
 * reason a human reads in review. This list should only ever SHRINK. Never add
 * an entry to get a run green.
 */
const COMPONENT_TEST_EXEMPT: Record<string, string> = {};

describe('entity editor coverage', () => {
  const slugs = entityEditorSlugs();

  it('registers at least one editor (the gate must not pass vacuously)', () => {
    expect(
      slugs.length,
      'No entity editors are registered, so every assertion below would pass ' +
        'trivially. The definitions barrel is probably not imported.'
    ).toBeGreaterThan(0);
  });

  it('every registered editor has a component test', () => {
    const missing = slugs.filter((slug) => {
      if (slug in COMPONENT_TEST_EXEMPT) return false;
      return !existsSync(resolve(definitionsDir, `${slug}.component.test.tsx`));
    });

    expect(
      missing,
      `These entity editors have no component test. Add definitions/<slug>.component.test.tsx for each — see the service one for the shape, and renderEntityEditor() in testing/ for the harness:\n${missing
        .map((slug) => `  - ${slug}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('every registered editor has a form contract', () => {
    const contracted = new Set(
      REGISTERED_FORMS.map((form) => form.entitySlug).filter(Boolean)
    );
    const missing = slugs.filter((slug) => !contracted.has(slug));

    expect(
      missing,
      `These entity editors have no entry in the form-contract registry, so nothing proves the body they POST is one the API accepts. Add a registry entry with \`entitySlug\` set:\n${missing
        .map((slug) => `  - ${slug}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('every entitySlug in the form registry resolves to a real editor', () => {
    const stale = REGISTERED_FORMS.map((form) => form.entitySlug)
      .filter((slug): slug is string => Boolean(slug))
      .filter((slug) => !getEntityEditor(slug));

    expect(
      stale,
      `These form-contract entries name an entity editor that is not registered — the editor was renamed or deleted and the registry was not updated:\n${stale.map((slug) => `  - ${slug}`).join('\n')}`
    ).toEqual([]);
  });

  it('has no orphan component test (every spec matches a registered editor)', () => {
    const registered = new Set(slugs);
    const orphans = readdirSync(definitionsDir)
      .filter((name) => name.endsWith('.component.test.tsx'))
      .map((name) => name.replace('.component.test.tsx', ''))
      .filter((slug) => !registered.has(slug));

    expect(
      orphans,
      `These component tests exist but no editor is registered under that slug, so they guard nothing:\n${orphans
        .map((slug) => `  - ${slug}`)
        .join('\n')}`
    ).toEqual([]);
  });

  it('gives every component-test exemption a written reason', () => {
    for (const [slug, reason] of Object.entries(COMPONENT_TEST_EXEMPT)) {
      expect(reason.length, `${slug} needs a real reason`).toBeGreaterThan(20);
    }
  });
});
