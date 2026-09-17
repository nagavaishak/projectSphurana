'use client';

import { useNavigate, useRouterState } from '@tanstack/react-router';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { useListLocations } from './api/list-locations/list-locations.hook.js';
import type { OrganizationLocation } from './api/types.js';
import {
  branchHandle,
  branchIdFromPath,
  findBranchByHandle,
  swapBranchInPath,
} from './branch-path.js';

/**
 * The branch the user is currently working in.
 *
 * THE URL IS THE SOURCE OF TRUTH (`/dashboard/l/:locationId/…`, plan §4).
 * Storage is the fallback, and it exists for exactly two cases: org-level pages
 * that sit OUTSIDE the branch prefix but still show the switcher
 * (`/dashboard/settings`, `/dashboard/locations`), and the cold entry point —
 * a bare `/dashboard/x` or a fresh tab, where the redirect route needs to know
 * which branch to send the user back to.
 *
 * That ordering is what makes a branch link shareable: paste a colleague a
 * `/dashboard/l/cork/calendar` URL and they see CORK, regardless of whichever
 * branch their own localStorage remembers.
 *
 * `setLocation` is now a NAVIGATION, not a write — see the note on it.
 */

const STORAGE_KEY = 'borradh.activeLocationId';
/**
 * The URL segment for the remembered branch — its slug where it has one.
 *
 * Stored ALONGSIDE the id rather than derived from it, because the components
 * that build links (`useResolvedRoutes`) deliberately avoid the locations
 * query, and without this they would have no way to know the slug and would
 * emit id-form URLs on every org-level page. Two keys, written together, keep
 * the readable URL free of a network round-trip.
 */
const HANDLE_STORAGE_KEY = 'borradh.activeLocationHandle';

/** Cross-component sync without a store library: one key, one subscriber set. */
const listeners = new Set<() => void>();

/**
 * The last branch this browser was in, or null. Exported because the two
 * un-prefixed entry points (`/dashboard` and the compatibility splat) resolve
 * their branch OUTSIDE React, in `beforeLoad`, where no hook can run.
 */
export function readRememberedLocationId(): string | null {
  return readStoredId();
}

function readStoredId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari private mode / storage disabled. A null id falls back to the
    // primary location, which is the correct behaviour anyway.
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` only fires in OTHER tabs, which is exactly the case the in-process
  // listener set cannot cover.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

/**
 * Persist "the branch I was last in" WITHOUT navigating.
 *
 * Called from the branch layout's `beforeLoad`, where the id has just been
 * validated against the org's real locations — so what gets stored is never a
 * junk id someone typed into the address bar. The redirect route reads it back
 * to answer "which branch did this person mean?" for a bare `/dashboard/x`.
 */
export function rememberActiveLocationId(id: string, handle = id): void {
  if (readStoredId() === id && readRememberedLocationHandle() === handle)
    return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
    window.localStorage.setItem(HANDLE_STORAGE_KEY, handle);
  } catch {
    // Non-fatal: the choice just won't survive a reload.
  }
  for (const listener of listeners) listener();
}

/** The remembered branch's URL segment (slug where it has one, else its id). */
export function readRememberedLocationHandle(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(HANDLE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Resolves the active location against the org's real locations.
 *
 * Always returns a location once loading finishes and the org has any, so
 * callers never handle "no branch selected" — a stored id that no longer
 * exists (branch deleted, or a shared machine) falls back to the primary
 * rather than stranding the user on a dead id.
 */
export function useActiveLocation(): {
  location: OrganizationLocation | null;
  locations: OrganizationLocation[];
  setLocation: (id: string) => void;
  isLoading: boolean;
  /** True when the org has more than one branch — i.e. switching is meaningful. */
  isMultiLocation: boolean;
} {
  const { locations, isLoading } = useListLocations();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const storedId = useSyncExternalStore(subscribe, readStoredId, () => null);
  const storedHandle = readRememberedLocationHandle();

  // URL first, storage second — see the module note.
  const urlId = branchIdFromPath(pathname);
  const activeId = urlId ?? storedId;

  const primary = locations.find((l) => l.isPrimary) ?? locations[0] ?? null;
  // `activeId` may be a slug (from the URL) or an id (from storage), so the
  // lookup accepts either.
  const resolved = activeId
    ? (findBranchByHandle(locations, activeId) ?? null)
    : null;
  const location = resolved ?? primary;

  // Heal a stale POINTER, not a stale URL. A bad id in the address bar is the
  // branch layout's job (it 404s); this only repairs storage, so the next cold
  // start begins from a live branch instead of falling back again.
  //
  // The HANDLE is repaired too, and both halves of that matter:
  //
  //  - It is checked, not just the id. The two keys are written together but a
  //    rebuilt database, a renamed branch or a switched org can leave a handle
  //    that resolves to nothing while the id still looks plausible — and the
  //    handle is what `useResolvedRoutes` puts into every link.
  //  - It is written as the branch's real handle. This used to call
  //    `rememberActiveLocationId(location.id)` and let `handle` default to the
  //    ID, so healing a stale pointer replaced a readable `/l/cork-city` with
  //    an opaque `/l/e2e_test_a1b2…` for the rest of the session.
  useEffect(() => {
    if (isLoading || urlId || !location) return;
    const handle = branchHandle(location);
    const pointerIsStale = Boolean(storedId) && !resolved;
    const handleIsStale =
      storedHandle !== null && !findBranchByHandle(locations, storedHandle);
    if (pointerIsStale || handleIsStale) {
      rememberActiveLocationId(location.id, handle);
    }
  }, [isLoading, urlId, storedId, storedHandle, resolved, location, locations]);

  /**
   * Switching branch NAVIGATES, keeping the sub-path: from Dublin's week
   * calendar you land on Cork's week calendar. That is the whole reason the
   * branch lives in the URL — the new view is shareable and back-button-able,
   * which a stored-state switch could never be.
   *
   * From an org-level page (`swapBranchInPath` → null) it records the choice
   * and stays put, rather than throwing the user out of the settings form they
   * are half-way through.
   */
  const setLocation = useCallback(
    (id: string) => {
      const target = locations.find((l) => l.id === id);
      const handle = target ? branchHandle(target) : id;
      rememberActiveLocationId(id, handle);
      const next = swapBranchInPath(pathname, handle);
      if (next) void navigate({ to: next });
    },
    [navigate, pathname, locations]
  );

  return {
    location,
    locations,
    setLocation,
    isLoading,
    isMultiLocation: locations.length > 1,
  };
}
