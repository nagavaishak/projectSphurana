'use client';

import { Navigate, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect } from 'react';

import { EntityFormPage } from '@/components/app/entity-editor';
import { ROUTES } from '@/lib/route-paths';

import './definitions/index';
import { type EntityEditorDefinition, getEntityEditor } from './registry';

/**
 * The single host for every create/edit page.
 *
 * The layout is rendered HERE, unconditionally, for every entity — the entity
 * only supplies config and state (see `registry.ts`). That is the whole reason
 * for the `/create/:entity` shape: with one page instead of N, a per-entity
 * editor cannot forget the save bar, lose the section nav, or drift in spacing,
 * because there is no per-entity page to get wrong.
 */
export function EntityEditorRoute({
  slug,
  id,
  mode,
}: {
  slug: string;
  id?: string;
  mode: 'create' | 'edit';
}) {
  const definition = getEntityEditor(slug);

  if (!definition) {
    // An unknown slug is a bad URL, not a crash.
    return <Navigate replace to={ROUTES.dashboard} />;
  }

  // Keyed on the slug: `definition.use` is a different hook per entity, so the
  // host must REMOUNT rather than swap hooks inside one instance, which would
  // break the rules of hooks.
  return (
    <EntityEditorHost definition={definition} id={id} key={slug} mode={mode} />
  );
}

function EntityEditorHost({
  definition,
  id,
  mode,
}: {
  definition: EntityEditorDefinition;
  id?: string;
  mode: 'create' | 'edit';
}) {
  const navigate = useNavigate();
  const editor = definition.use({ id });
  const { notFound } = editor;

  useEffect(() => {
    if (notFound) void navigate({ replace: true, to: definition.listPath });
  }, [notFound, navigate, definition.listPath]);

  if (editor.isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (notFound) return null;

  return (
    <EntityFormPage
      config={editor.config}
      errors={editor.errors}
      isEdit={mode === 'edit'}
      isSaving={editor.isSaving}
      saveDisabled={editor.saveDisabled}
      onCancel={editor.onCancel}
      onSave={editor.onSave}
      setValue={editor.setValue}
      values={editor.values}
    />
  );
}
