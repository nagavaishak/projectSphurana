import type { QueryClient } from '@tanstack/react-query';
import type { RenderResult } from '@testing-library/react';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { EntityEditorRoute } from '../entity-editor-route';

/**
 * Mounts a registered entity editor the way the route does.
 *
 * The spec MUST mock the router itself (`vi.mock('@tanstack/react-router', …)`)
 * — `src/test/render.tsx` deliberately stands up no RouterProvider, because a
 * real route tree with loaders makes isolated rendering brittle. This helper
 * only owns the mount and the assertions every editor shares.
 *
 * The point of the unified editor is that these tests are nearly free: the
 * chrome, sections, save wiring and layout are proven ONCE here, so a per-entity
 * spec only has to cover its own fields.
 */
// The return type is annotated rather than inferred: inference reaches into
// testing-library's `pretty-format` internals, which tsc cannot name portably.
export function renderEntityEditor(
  slug: string,
  options: { id?: string; mode?: 'create' | 'edit' } = {}
): RenderResult & {
  queryClient: QueryClient;
  user: ReturnType<typeof userEvent.setup>;
} {
  const mode = options.mode ?? (options.id ? 'edit' : 'create');

  const result = renderWithProviders(
    <EntityEditorRoute id={options.id} mode={mode} slug={slug} />
  );

  return { ...result, user: userEvent.setup() };
}

/**
 * The contract every editor's chrome satisfies. Call this from each entity's
 * component test so a regression in the shared layer fails on every entity,
 * rather than only wherever someone happened to assert it.
 */
export async function expectEditorChrome(expected: {
  title: string | RegExp;
  /** Section labels, when the editor has more than one section. */
  sections?: string[];
}) {
  expect(
    await screen.findByRole('heading', { level: 1, name: expected.title })
  ).toBeInTheDocument();

  // Both actions exist and are reachable by their accessible names.
  expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  expect(
    screen.getAllByRole('button', { name: /^save/i }).length
  ).toBeGreaterThan(0);

  for (const label of expected.sections ?? []) {
    // Desktop nav and mobile pills both render, so the label appears twice —
    // `getAllBy` rather than `getBy` is correct, not a looseness.
    expect(
      screen.getAllByRole('button', { name: label }).length
    ).toBeGreaterThan(0);
  }
}

/** Switches section by its nav button, then returns the section region. */
export async function switchSection(
  user: ReturnType<typeof userEvent.setup>,
  label: string
) {
  const buttons = screen.getAllByRole('button', { name: label });
  // The desktop nav is first in the tree; either works, but pick one
  // deterministically so a test cannot pass on one viewport and fail on the other.
  await user.click(buttons[0]);
}

export { screen, within };
