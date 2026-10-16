# Domain docs

## Layout

This repo uses a single context:
- `CONTEXT.md` at the repo root for domain terms and context.
- `docs/adr/` for architecture decision records.

## Before exploring

Read `CONTEXT.md` and ADRs relevant to the work.

If these files do not exist, proceed silently. Do not suggest
creating them upfront. Domain modeling creates them when terms
or decisions are resolved.

## Vocabulary

Use the domain terms defined in `CONTEXT.md` consistently in
issues, proposals, code, and tests. Reconsider unfamiliar terms
or note genuine glossary gaps for domain modeling.

## Decision conflicts

Explicitly flag proposals that contradict an existing ADR,
identify the ADR, and explain why the decision should be reopened.
