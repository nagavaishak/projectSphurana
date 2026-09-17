# Alludium Practice Repository

This repository is a sanitized practice surface for an AI-assisted product-engineering workflow.

It is based on a larger React/TypeScript monorepo and is used to practise:

- repository reconnaissance;
- frontend → API → business-logic data flow;
- TypeScript and React changes;
- focused AI-assisted implementation;
- linting, type-checking, tests, builds, and diff review;
- explaining assumptions, verification, and risk.

## Working method

Read [`LLM_PRODUCTION_ENGINEERING_HARNESS.md`](./LLM_PRODUCTION_ENGINEERING_HARNESS.md) before making a change. It defines the workflow for understanding a task, inspecting the repository, using AI, implementing a small change, and verifying the result.

Read [`LLM_PRODUCTION_ENGINEERING_NOTES.md`](./LLM_PRODUCTION_ENGINEERING_NOTES.md) for the learning context and current preparation state.

## Safety boundary

This is an educational copy. It does not contain production secrets, Git history, internal deployment configuration, or environment files. Do not add secrets or connect it to production systems.

Inspect the available scripts before running commands:

```bash
pnpm run
```
