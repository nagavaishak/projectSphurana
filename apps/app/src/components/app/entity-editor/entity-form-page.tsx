'use client';

import { useMemo, useState } from 'react';

import { EntityEditor } from './entity-editor';
import { EntityFormSectionRenderer } from './entity-form';
import type {
  EntityFieldContext,
  EntityFormConfig,
  EntityFormErrors,
  EntityFormValues,
} from './entity-form-types';

interface EntityFormPageProps {
  config: EntityFormConfig;
  values: EntityFormValues;
  errors?: EntityFormErrors;
  setValue: (name: string, value: unknown) => void;
  isEdit: boolean;
  isSaving?: boolean;
  /** A required field is still empty — grey the Save button. */
  saveDisabled?: boolean;
  /**
   * Submit. May return the id of the section to REVEAL afterwards — how an
   * editor whose validation spans more than one section points the operator at
   * the failure instead of bouncing them somewhere it is invisible.
   */
  onSave: () => string | undefined | Promise<string | undefined>;
  onCancel: () => void;
}

/**
 * The unified create/edit page.
 *
 * A feature supplies a declarative config (sections → blocks → rows → fields),
 * its current values, and a setter. Everything else — page chrome, section
 * navigation, desktop/mobile layout, field rendering, error placement, save and
 * cancel — is shared and identical across entities.
 *
 * Form STATE stays with the feature rather than living here. Each entity
 * already owns a controller that does validation and builds its API payload
 * (`useServiceForm` and friends); swallowing those into this component would
 * mean reimplementing per-entity validation generically, which is exactly the
 * kind of rewrite that turns a UI unification into a behaviour change.
 *
 * See docs/plans/location-focused-redesign.md §7.
 */
export function EntityFormPage({
  config,
  values,
  errors = {},
  setValue,
  isEdit,
  isSaving = false,
  saveDisabled = false,
  onSave,
  onCancel,
}: EntityFormPageProps) {
  const [sectionId, setSectionId] = useState(config.sections[0]?.id);

  const active =
    config.sections.find((section) => section.id === sectionId) ??
    config.sections[0];

  const ctx: EntityFieldContext = useMemo(
    () => ({ values, errors, setValue, disabled: isSaving }),
    [values, errors, setValue, isSaving]
  );

  const handleSave = async () => {
    // A failed save on a section the operator cannot see looks like nothing
    // happened, so land them where the error is. Editors whose validation is
    // all in one section say nothing and get the first section, as before.
    const reveal = await onSave();
    setSectionId(typeof reveal === 'string' ? reveal : config.sections[0]?.id);
  };

  return (
    <EntityEditor
      activeSection={active?.id}
      aside={config.aside}
      isSaving={isSaving}
      onCancel={onCancel}
      onSave={() => void handleSave()}
      saveDisabled={saveDisabled}
      onSectionChange={setSectionId}
      sections={config.sections.map(({ id, label, icon }) => ({
        id,
        label,
        icon,
      }))}
      title={config.title(isEdit)}
    >
      {active && <EntityFormSectionRenderer ctx={ctx} section={active} />}
    </EntityEditor>
  );
}
