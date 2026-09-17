import type {
  EntityFormConfig,
  EntityFormErrors,
  EntityFormValues,
} from '@/components/app/entity-editor';

/**
 * What an entity must supply for the shared editor to render it.
 *
 * Note what is NOT here: no layout, no chrome, no section navigation, no save
 * button. The route renders those, always, for every entity. An entity supplies
 * a config and its form state and nothing else — which is the point. Per-entity
 * editor PAGES could each forget a piece or drift in spacing; there is only one
 * page here, so they cannot.
 */
export interface EntityEditorState {
  config: EntityFormConfig;
  values: EntityFormValues;
  errors?: EntityFormErrors;
  setValue: (name: string, value: unknown) => void;
  isSaving?: boolean;
  /**
   * Set while a required field is still empty. The route greys the Save button
   * rather than letting the user submit and meet a toast — a disabled control
   * says "not yet", a rejected submit says "you got it wrong".
   */
  saveDisabled?: boolean;
  /**
   * Submit. May return the id of the section the page should REVEAL afterwards
   * — for editors whose validation spans more than one section.
   */
  onSave: () => string | undefined | Promise<string | undefined>;
  onCancel: () => void;
  /** Edit mode fetching the record. The route renders the spinner. */
  isLoading?: boolean;
  /** Edit mode: the id does not resolve. The route redirects. */
  notFound?: boolean;
}

export interface EntityEditorDefinition {
  /** URL segment: `/create/service`, `/edit/service/:id`. */
  slug: string;
  /** Where cancel/success returns to. */
  listPath: string;
  /**
   * A hook, not a component — so the route owns the tree and the entity owns
   * only state. Called with the record id in edit mode.
   *
   * Because this is dispatched by slug, the route MUST remount when the slug
   * changes (it keys on it); swapping which hook runs inside one component
   * instance would break the rules of hooks.
   */
  use: (args: { id?: string }) => EntityEditorState;
}

const definitions = new Map<string, EntityEditorDefinition>();

export function registerEntityEditor(definition: EntityEditorDefinition): void {
  definitions.set(definition.slug, definition);
}

export function getEntityEditor(
  slug: string
): EntityEditorDefinition | undefined {
  return definitions.get(slug);
}

export function entityEditorSlugs(): string[] {
  return [...definitions.keys()];
}

/** `/create/service` */
export function createEntityPath(slug: string): string {
  return `/create/${slug}`;
}

/** `/edit/service/abc123` */
export function editEntityPath(slug: string, id: string): string {
  return `/edit/${slug}/${id}`;
}
