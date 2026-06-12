---
name: worktree-worker
description: "Hand off a feature or fix to an independent worktree worker: gather requirements from the user, then plan and implement the change autonomously in an isolated git worktree, finishing with a PR against main via /pr. Use whenever the user types /worktree-worker, says to 'hand off' a task, 'start a worktree worker', 'build this in a worktree', 'spin up a worker for X', or wants a change implemented end-to-end on its own branch ending in a PR — even if they only give a rough one-line brief."
---

# /worktree-worker — Requirements → Worktree → Implementation → PR

You are being handed a task. The user's invocation (and any surrounding conversation) is the *initial brief* — possibly rough, possibly complete. Your job is to turn it into a confirmed set of requirements, then execute those requirements autonomously in an isolated worktree, and deliver a pull request against `main` as the final output.

The shape of the handoff matters: the requirements interview is the **last** point where the user expects to be involved. After they confirm the requirements, they are walking away — treat questions after that point as a failure of the interview, not a normal part of the work.

## Phase 1 — Absorb & explore

Before asking the user anything, ground yourself in the code so your questions are informed rather than generic:

1. Re-read the initial brief and extract what is already decided: scope, affected features, constraints, desired outcome.
2. Explore the relevant parts of the codebase. Use the AGENTS.md context map to find the right `context/*.md` files (e.g. `context/page-creation.md` for new screens, `context/archive-and-settlement.md` for settlement work, `supabase/PIN_ECONOMY_SCHEMA.md` for betting/ledger code) and read the code the task will touch.
3. Note what the brief leaves genuinely ambiguous — places where two reasonable implementations would diverge.

If the user invoked the skill with no brief at all, ask for one first; there is nothing to explore yet.

## Phase 2 — Adaptive requirements interview

Close only the genuine gaps. Use `AskUserQuestion` for each round of questions — concrete options beat open-ended prompts, because the user can pick fast and add nuance via "Other".

Good gap categories (ask only the ones the brief doesn't already answer):

- **Scope** — what's in, and just as importantly what's explicitly out.
- **Surface area** — which screens, tables, hooks, or RPCs are affected; new vs. modified.
- **Behavior at the edges** — empty states, permissions/roles, archived vs. live data, concurrency with the weekly archive tick.
- **Definition of done** — what the user will look at to judge the PR (a screen state, a query result, a settlement outcome).

Iterate until the requirements are unambiguous. If the brief already answers everything, skip the questions entirely — don't interview for ceremony.

**End the phase with a playback:** a short written requirements summary (scope, out-of-scope, acceptance criteria) and ask the user to confirm it. This summary is the contract for the autonomous phase — when in doubt later, you resolve ambiguity against it instead of going back to the user.

## Phase 3 — Enter the worktree

Once requirements are confirmed, call `EnterWorktree` with a descriptive kebab-case `name` derived from the task, **always ending in a unique suffix**: the date plus a few random hex characters, e.g. `bounty-claim-cooldown-20260612-3f9a` (generate it with `date +%Y%m%d` and `openssl rand -hex 2`, or equivalent). The default `worktree.baseRef` branches from `origin/main`, which is exactly the base the eventual PR needs.

The suffix is not optional ceremony: this workflow never cleans up local or remote branches (the `/pr` skill's merge step deliberately keeps them so merged work can be re-landed), so a plain task-derived name like `bounty-claim-cooldown` would collide with the stale branch the moment the same task — or a follow-up to it — runs a second time. Unique-by-construction names make that collision impossible by design.

- If the session is **already inside** a worktree, say so and ask whether to continue there or switch — `EnterWorktree` cannot create a nested worktree with `name` from within one.
- From this point on you operate autonomously: no further questions unless you hit something that genuinely contradicts the confirmed requirements or requires an irreversible decision the user must own.

## Phase 4 — Plan & implement

Plan first, then build. Follow the repo's conventions — they are hard constraints, not suggestions:

- The four-layer blueprint for data-backed features: migration → `db.ts` → hook → screen → navigation (`context/page-creation.md`).
- All AGENTS.md hard rules: queries through `db.ts`, `seasons.getCurrent()` not `getLatest()`, pure compute functions wrapped in `useMemo` at the screen, uuid ids, schema read from `supabase/schema.sql` never from migration history.
- **The database is shared and live.** A worktree isolates *files*, not Supabase — `supabase db push` from inside a worktree still hits the production database. If the task requires a migration, write the `.sql` file and surface it to the user before pushing; pushing schema changes is one of the few legitimate reasons to interrupt the autonomous phase.

Commit incrementally on the worktree branch with clear messages as logical units complete, ending each with the standard trailer:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

## Phase 5 — Verify & hand back

1. **Verify** per repo convention: there is no test suite, so typecheck (`tsc --noEmit` from `app/`) and exercise the change through the Expo dev server where feasible. Don't hand back unverified work silently — if something couldn't be verified, say exactly what and why.
2. **Open the PR** by invoking the `pr` skill via the Skill tool. It pushes the branch and creates the PR against `main` with a generated title and body — don't reimplement that flow with raw `gh` commands.
3. **Report**: the PR URL, a summary of what was built mapped against the confirmed requirements, and any deviations or open questions discovered during implementation.
4. **Leave the worktree session active.** Call `ExitWorktree` only if the user asks; keeping it lets review feedback land as follow-up commits on the same branch and PR.
