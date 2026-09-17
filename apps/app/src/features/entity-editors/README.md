# Adding an entity to the unified create/edit editor

One page renders every create and edit form in the app: `/create/:entity` and
`/edit/:entity/:id`. Adding an entity is a **registration**, never a new page.

Everything below is already built and shared — do not reimplement any of it:

- page chrome (title, Cancel/Save, mobile back arrow and sticky Save bar)
- section navigation (desktop nav card, mobile pills)
- desktop scroll behaviour (chrome is fixed; only the form column scrolls)
- spacing, taken from Figma node `3105:8141` (1079px centred content, 778px form
  column, 269px aside, 32px between blocks, 16px between fields, 8px label→input)
- field rendering, error placement, disabled-while-saving

## What you write

One file: `src/features/entity-editors/definitions/<entity>.ts`. Register it,
then add `import './<entity>';` to `definitions/index.ts` (one line — that file
is shared, so touch only your line).

```ts
registerEntityEditor({
  slug: 'product',                 // → /create/product, /edit/product/:id
  listPath: ROUTES.catalogProducts, // where Cancel and a successful save return
  use: ({ id }) => {
    // Your existing form controller. Do NOT rewrite validation or the payload.
    const controller = useProductForm({ productId: id });
    return {
      config,                       // EntityFormConfig — sections → blocks → rows → fields
      values, errors, setValue,
      isSaving, onSave, onCancel,
      isLoading,                    // edit mode still fetching
      notFound,                     // id does not resolve → the route redirects
    };
  },
});
```

## Rules

1. **Do not rewrite form state, validation, or the API payload.** Reuse the
   existing controller/schema behind the current dialog. A UI unification that
   silently changes what gets POSTed is a bug, not a refactor. If the dialog has
   no reusable controller, extract one first — unchanged — then register it.
2. **Rich existing fields come in via `kind: 'custom'`.** Variant editors,
   pickers, conditional blocks, uploaders: render the component you already have
   and read/write through the field context. Only use `text` / `textarea` /
   `select` / `number` / `checkbox` for genuinely plain fields.
3. **Sections are jobs, not wizard steps.** A page has room a dialog did not, so
   3 steps usually collapse into 1–2 sections. Multiple sections only when they
   are different tasks (e.g. Details vs Team Members).
4. **Rows lay fields side by side**: `rows: [[fieldA, fieldB]]` is two columns on
   desktop, stacked on mobile.
5. **Delete the dialog and repoint its call sites** in the same change — a dead
   dialog left behind is the thing that drifts. Update any tests that mounted it
   to mount the registered editor instead.
6. **Do not edit anything under `src/components/app/entity-editor/`.** That is
   the shared layer; if it genuinely cannot express your form, say so rather
   than special-casing it.

## When NOT to register an entity

An entity earns a full page when it has multiple sections, rich or conditional
fields, or an aside. Keep a dialog when the form is:

- **one or two plain fields** — suppliers (name + description), product brands,
  product categories. A full page for two inputs is worse than the dialog it
  replaced, and these are usually created inline from the form that needs them.
- **an in-context quick-add or row edit** — creating a lead from the till or the
  calendar, editing a time entry, editing a gift card. These are fired from
  somewhere you must return to; a page navigation loses that place.
- **a confirmation** — it is not a form.
- **another product's own flow** — the campaign wizard, the post composer, the
  intake-form and consent-form builders. Those have their own shapes.

## Testing is REQUIRED, and gated

`entity-editor-coverage.test.ts` fails the build if a registered editor is
missing either tier. Both are required; neither substitutes for the other.

**Tier 1 — component test.** `definitions/<slug>.component.test.tsx`. Mount with
`renderEntityEditor(slug)` from `../testing/render-entity-editor`, call
`expectEditorChrome({ title, sections })`, then cover YOUR fields: they render,
they accept input, sections swap, cancel leaves. Copy `service.component.test.tsx`.

Keep it short. The chrome, section navigation, layout, scroll behaviour and save
bar are proven once in the shared harness — a per-entity spec that re-asserts
them is duplicating a test, not adding one.

**Tier 2 — form contract.** Add an entry to `src/test/form-contract/registry.ts`
with `entitySlug: '<slug>'`, and a `*.contract.test.tsx` that runs the shared
harness. This proves the five properties, including that the body you POST is
one the API actually accepts.

Why both: a form can render perfectly and still send a request the API rejects.
That is not hypothetical here — a `POST /leads` 400 shipped because a blank
optional was sent as `''` instead of being omitted. The component test was
green; only the contract would have caught it.

Registering an editor without either tier is a red build, not a TODO.

## Verify

- `pnpm exec tsc --noEmit -p tsconfig.json`
- `pnpm exec vitest run` (whole app suite — the nav-reachability gate is in it)
- Load `/create/<entity>` and `/edit/<entity>/<id>` and confirm a real save works.
