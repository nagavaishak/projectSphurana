# LLM Production Engineering Harness

This is the single operational harness for AI-assisted production-engineering practice and the Alludium live-coding session.

`LLM_PRODUCTION_ENGINEERING_NOTES.md` contains the explanations, mental models, mistakes, and interview context. This file contains the working procedure.

## Purpose

Work clearly and safely on an unfamiliar React + TypeScript repository while using AI responsibly.

## Core loop

```text
Understand → Inspect → Plan → Ask AI → Implement → Verify → Explain
```

Never turn a vague request into a large generated rewrite.

## 1. Understand the request

Before editing, state:

> My understanding is that we need to ___, for ___, while keeping ___ unchanged.

Identify the requested behaviour, non-goals, expected result, unclear details, and success criteria. Ask one focused question or state a visible assumption when something is unclear.

## 2. Inspect before editing

Identify:

- package manager and `package.json` scripts;
- application entry point;
- relevant components, hooks, types, API/data code, and tests;
- conventions used by nearby code;
- existing loading, empty, and error handling.

Useful commands, adjusted to the repository:

```bash
pwd
ls
cat package.json
pnpm run
rg --files -g '!node_modules' | sed -n '1,120p'
```

Trace the data flow before changing it. Do not guess.

## 3. Plan the smallest safe change

State:

1. files likely to change;
2. smallest behaviour to add or correct;
3. loading, empty, error, and boundary cases;
4. checks that will prove it works.

Prefer a narrow vertical slice. Avoid unrelated refactors, new dependencies, and speculative abstractions.

## 4. Ask AI in controlled steps

Investigation:

```text
Inspect the relevant files and explain the current data flow.
Do not edit anything yet. Identify assumptions, risks, and the smallest change.
```

Implementation:

```text
Implement only this requirement: ___ .
Follow the existing repository conventions. Avoid unrelated refactors.
Explain the files changed and any assumptions.
```

Review:

```text
Review the diff for type errors, incorrect loading/empty/error states,
unnecessary changes, and missing verification. Do not edit yet.
```

AI output is a proposal. We own the final code and must be able to explain it.

## 5. Implement carefully

- Make one coherent change at a time.
- Reuse existing types, hooks, clients, and helpers where they fit.
- Keep behaviour outside the requirement unchanged.
- Do not invent APIs, data shapes, or product requirements.
- Do not add authentication, integrations, migrations, secrets, or deployment changes unless explicitly requested.
- Keep changes reversible.

## 6. Verify before claiming completion

Run only scripts that actually exist. Never claim a check passed unless it was run.

```bash
pnpm run
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also check the happy path and at least one meaningful edge or failure path. Inspect the diff:

```bash
git diff --check
git diff
```

## React and TypeScript flow

Before editing a component, identify:

```text
props → component → rendered UI
event → state update → new render
async work → loading/data/error state → rendered result
```

Track data shapes explicitly: object, array of objects, array of strings, number, Promise, or result object.

## 90-minute session rhythm

- 0–10 minutes: read the task and inspect the repository;
- 10–20 minutes: clarify requirements, assumptions, and success criteria;
- 20–55 minutes: implement the smallest working slice;
- 55–75 minutes: run checks and handle important edge cases;
- 75–85 minutes: inspect the diff and remove unnecessary changes;
- 85–90 minutes: explain decisions, verification, and remaining risks.

## Natural spoken phrases

- “I’m inspecting the existing pattern before changing it.”
- “This part is ambiguous, so I’m making this assumption.”
- “I’ll ask AI to investigate first rather than generate a broad rewrite.”
- “The AI suggested this, but I’m checking the diff and running the checks myself.”
- “The happy path works; I’m checking the empty and failure paths now.”
- “I don’t know that from the repository yet, so I’ll verify instead of guessing.”

## Risk control

Do not run destructive commands, production database commands, migrations, secret changes, or deployment actions during practice without explicit approval and a clear reason.

If something fails, describe the evidence, narrow the cause, and test the smallest next hypothesis.

## Completion explanation

Finish with:

> I changed ___ because ___. I verified it with ___. The remaining uncertainty is ___. If this were production, I would next ___ .

## Repository strategy

Borradh is a production monorepo. Use it read-first to learn repository reconnaissance, API-first architecture, React/TypeScript data flow, testing, and production risk control. Keep its existing `CLAUDE.md`, `.claude/rules`, environment files, and safeguards intact.

Any Borradh code change must be explicitly scoped and performed on a safe branch or worktree. Do not run production commands or migrations as an exercise.

`projectSphurana` is the dedicated Alludium practice repository. Inspect its actual setup before deciding whether it needs any linting, type-checking, testing, monorepo, or deployment work.

The interview ZIP is the most faithful timed simulation because the session is described as a small React + TypeScript repository. Do not confuse Borradh’s large-repository practice with the dedicated practice repository or the interview ZIP.

## Learning mode

`LLM_PRODUCTION_ENGINEERING_NOTES.md` is the teaching source of truth for this track. Before a new exercise, scan it and use the current skill status and mistakes. Explain unfamiliar terms in plain English before using them, and ask for a hint before requesting a complete solution.
