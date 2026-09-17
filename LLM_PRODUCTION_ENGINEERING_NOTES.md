# LLM Production Engineering — Learning Notes

These notes are separate from `PRODUCT_ENGINEERING_NOTES.md`.

- `PRODUCT_ENGINEERING_NOTES.md` = JavaScript, backend, product-building, and system-design learning.
- This file = AI-assisted production engineering, repository work, verification, risk control, and Alludium interview preparation.
- `LLM_PRODUCTION_ENGINEERING_HARNESS.md` = the operating procedure used during practice and the live session.

## Alludium session

- Format: 90-minute screen-shared working session in an unfamiliar small React + TypeScript repository supplied as a ZIP.
- Environment: Node.js 20+, pnpm 10, editor, terminal, AI coding tool, and ZIP extraction.
- Evaluation: problem framing, system reasoning, verification, risk control, responsible AI use, and clear technical ownership.
- Not evaluated primarily: typing speed, memorised syntax, code volume, or UI polish.

## Working model

```text
Understand → Inspect → Plan → Ask AI → Implement → Verify → Explain
```

AI output is a proposal. The engineer owns the final code, assumptions, checks, and explanation.

## Alludium / Threadline context

Threadline was framed as a deterministic state and dependency layer around agents. Important themes are explicit state, evidence/dependencies, human approval, versioning, rebuilds, and receipts—not blind autonomous mutation.

## Borradh repository map

Borradh is a production monorepo used for read-first reconnaissance and architecture learning:

```text
apps/app             → React frontend
apps/api             → backend API
packages/api-client  → frontend HTTP client and API types
packages/features    → backend business logic
packages/database    → database schema and queries
```

It already has pnpm workspace/Turborepo, Biome linting, TypeScript checks, Vitest/Jest tests, Playwright E2E tests, build scripts, and GitHub Actions CI.

## Dedicated practice repository

- GitHub target: `https://github.com/nagavaishak/projectSphurana`
- This is the repository we will use for Alludium-style preparation when it is available locally.
- We will inspect its actual `package.json`, scripts, file structure, checks, and data flow before making any assumptions.
- The provided product-engineering stack map is a reference model: Codex + `AGENTS.md`, Notion for documentation, Linear for delivery tracking, TypeScript, React/Next.js, Tailwind, database access, migrations, GitHub Actions, linting, type-checking, tests, builds, and deployment.
- We will adopt only the tools that the repository actually contains; we will not add a monorepo, database, deployment, or AI integration merely to imitate the reference.

## Repository safety

- Keep Borradh’s `CLAUDE.md`, `.claude/rules`, environment files, and production safeguards intact.
- Use a safe branch or worktree for any agreed Borradh change.
- Do not run production commands, migrations, secret changes, or destructive cleanup as an exercise.
- `projectSphurana` is the primary Alludium practice target. The interview ZIP is the faithful timed simulation when supplied. Borradh is the large-repository reference surface.

## `projectSphurana` upload decision

`projectSphurana` is currently empty and is intended as the Alludium practice target. Borradh must not be mirrored blindly: it belongs to the `Borradh-Media` GitHub organization and contains production-oriented history and environment/configuration files.

Before any upload, confirm that `projectSphurana` is private and that copying Borradh source there is authorized. Prefer a sanitized educational snapshot or dedicated practice branch that excludes `.git`, secrets, environment files, `node_modules`, build artifacts, and unrelated production history. Keep the original Borradh remote unchanged.

The local Borradh checkout’s `origin` now points to `https://github.com/nagavaishak/projectSphurana.git`. This only changes Git remote configuration; no code has been uploaded yet.

## Current preparation state

- Harness created and consolidated.
- Borradh repository mapped at a high level.
- Next: trace one real React → API client → backend → data path, then practise a small scoped change with verification.
