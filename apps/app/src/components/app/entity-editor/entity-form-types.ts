import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The declarative shape behind every create/edit page.
 *
 * Deliberately content-agnostic: a feature supplies a config and a values
 * object, and gets the same page chrome, the same field rendering, the same
 * error placement and the same save behaviour as every other entity. Nothing
 * here knows what a service or a product is.
 *
 * `Values` is a flat record of field name → value. Keeping it flat (rather than
 * generic over an entity type) is what lets one renderer walk any config
 * without each feature declaring its own component tree.
 */
export type EntityFormValues = Record<string, unknown>;

export type EntityFormErrors = Record<string, string | undefined>;

export interface EntityFieldContext {
  values: EntityFormValues;
  errors: EntityFormErrors;
  setValue: (name: string, value: unknown) => void;
  disabled: boolean;
}

interface FieldBase {
  /** Key into `values` / `errors`. */
  name: string;
  label?: string;
  placeholder?: string;
  description?: string;
  /** Hide the field entirely — e.g. a deposit row when deposits are disabled. */
  hidden?: (values: EntityFormValues) => boolean;
  /**
   * Render the control but refuse input — for a field that stays meaningful in
   * the layout yet cannot be answered given the values above it (a product's
   * measure amount when the unit is "whole item").
   */
  disabled?: (values: EntityFormValues) => boolean;
}

export type EntityField =
  | (FieldBase & { kind: 'text' | 'textarea'; maxLength?: number })
  | (FieldBase & {
      kind: 'number';
      min?: number;
      max?: number;
      prefix?: string;
    })
  | (FieldBase & {
      kind: 'select';
      options: { value: string; label: string }[];
    })
  | (FieldBase & { kind: 'checkbox' })
  /**
   * Escape hatch. Rich, already-built fields (a variant editor, a practitioner
   * picker, a deposit block with its own conditional rows) render themselves
   * and read/write through the context. Without this, adopting the unified
   * editor would mean rewriting working fields — the main way a migration like
   * this introduces bugs.
   */
  | (FieldBase & {
      kind: 'custom';
      render: (ctx: EntityFieldContext) => ReactNode;
    });

/** A titled group of rows. Rows hold fields laid out side by side. */
export interface EntityFormBlock {
  title?: string;
  /** Each inner array is one row; a row of N fields splits into N columns. */
  rows: EntityField[][];
  hidden?: (values: EntityFormValues) => boolean;
}

export interface EntityFormSection {
  id: string;
  label: string;
  icon?: LucideIcon;
  blocks: EntityFormBlock[];
}

export interface EntityFormConfig {
  /** Page H1. Receives edit mode so one config covers create and edit. */
  title: (isEdit: boolean) => string;
  sections: EntityFormSection[];
  /** Desktop right-hand column (e.g. a photo uploader). */
  aside?: ReactNode;
}
