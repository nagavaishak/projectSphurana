# video-worker

BullMQ consumer for renders, asset analysis, graphics, content batches and Meta
sync. Deployed to Fly (`borradh-worker-*`).

## Type checking

`pnpm typecheck` runs `tsc -p tsconfig.app.json`. Two settings in that file are
deliberate and easy to "tidy" back into a broken state:

**`"paths": {}`** — drops the workspace path mappings inherited from
`tsconfig.base.json`, the same way `apps/api/tsconfig.app.json` does. With them,
`@borradh-workspace/features/x` resolves into that package's *source*, which
lives outside this project's `rootDir`, and every workspace import pairs a
TS6059 with a TS6307 — 2642 lines of noise that are artifacts of the mapping,
not defects. Without them the import resolves through `node_modules` exports to
the built `.d.ts`, which is also the module graph the process loads at runtime.
That matters: the check exists to catch imports the *deployed* worker cannot
resolve. It was added after `classifyServiceTechnique` — present in the services
barrel, absent from the feature barrel the worker imports — crash-looped the
preview worker on every boot.

**The `exclude` list** — `editor-state-builder.ts` and
`editor-state-assembler.ts` are quarantined. `buildEditorState` and
`EditorStateAssembler` have no callers anywhere in the repo (they were extracted
out of `main.ts` by `docs/plans/editor-state-builder-refactor.md` and never
wired in), and the template-engine rewrite has since deleted every remotion type
they import — `EditorState`, `Asset`, `Item`, `Track`, `ContentCardConfig`,
`StackedListConfig`. They cannot compile against the package as it exists.
Delete them or re-target them before giving them callers.

Note that `pnpm build` (tsup/esbuild) **does not** type check — it strips types.
This project's only type gate is the command above.
