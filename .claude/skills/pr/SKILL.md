---
name: pr
description: "Create a GitHub pull request for the current feature branch, optionally squash-merge it to main, and roll back already-merged PRs by reverting their squash commit. Use when the user asks to open/create a PR, types /pr, asks to merge a PR (or says yes to merging one just created), or asks to undo / revert / roll back a PR that was merged to main."
---

# /pr — Open, Merge, and Roll Back Pull Requests

One skill, three operations on the same lifecycle:

1. **Create** a PR for the current (pre-existing) feature branch.
2. **Merge** it to main — always by squash, so every PR lands as exactly one commit.
3. **Roll back** a merged PR by reverting that one squash commit.

The default flow is Create → offer to merge. Jump straight to "Merge" or "Roll back" when that's what the user asked for.

## Create the PR

1. **Gather context** in one batch:
   - `git rev-parse --abbrev-ref HEAD` — current branch (abort if it's `main`; tell the user to switch to a feature branch).
   - `git status --short` — warn if there are uncommitted changes; ask whether to commit them first or proceed.
   - `git log main..HEAD --oneline` — commits that will be in the PR.
   - `git diff main...HEAD --stat` — files changed.

2. **Push the branch** with upstream tracking: `git push -u origin HEAD`.

3. **Create the PR** with `gh pr create --base main`:
   - Title: a concise summary of the branch's changes (Conventional Commits style if the repo uses it, e.g. `feat:`, `fix:`). The title matters more than usual here: a squash merge uses it as the commit subject on main.
   - Body: a short summary section and a bullet list of key changes, derived from the commits/diff. Use a heredoc for the body.
   - End the PR body with:
     ```
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
     ```

4. **Report** the PR URL, then continue to the merge offer below.

## Offer to merge

After creating the PR (or when the user asks to merge an existing one), ask whether to merge to main now — use `AskUserQuestion` with two options: **Squash-merge now** and **Leave open for review**. Don't merge without an explicit yes.

If yes:

```bash
gh pr merge <number> --squash
```

**Always squash — never a merge commit, never rebase.** The point is rollback: a squash collapses the whole PR into a single commit on main, so the entire PR can later be undone with one `git revert`. A merge commit needs `-m` parent selection to revert, and a rebase scatters the PR across several commits that must be hunted down individually — both break the one-commit-one-revert guarantee this repo relies on. This rule holds even if the PR has only one commit anyway: consistency keeps the rollback recipe uniform.

- **No cleanup.** Don't pass `--delete-branch`, don't delete the local branch, don't switch to main, don't pull. Leave the checkout exactly where it is; the local branch and local main being stale after the merge is expected. Only update them if the user asks.
- If the merge fails (branch protection, required checks, conflicts), report `gh`'s error verbatim and stop — don't retry with a different merge strategy.
- Report the merge result, including the squash commit SHA on main (`gh pr view <number> --json mergeCommit`), since that's the handle for any future rollback.

## Roll back a merged PR

When the user asks to undo / revert / roll back a merged PR:

1. **Find the squash commit.**
   - If they gave a PR number: `gh pr view <number> --json mergeCommit,title,state`.
   - If they described it ("the bounty fix from yesterday"): locate it via `gh pr list --state merged --limit 10` or `git log origin/main --oneline` — squash commits carry the PR number as a `(#N)` suffix. Confirm with the user which PR you found before reverting.
2. **Get current main locally:** `git fetch origin`, then `git checkout main && git pull` (note which branch you were on so you can tell the user; per the no-cleanup rule they may still be on a feature branch).
3. **Revert:** `git revert --no-edit <sha>`. Because the squash merge guaranteed a single ordinary commit, no `-m` parent selection is needed — this is exactly the payoff of the always-squash rule. Amend the message to append the repo's standard `Co-Authored-By` trailer.
4. **Push directly to main:** `git push origin main`. No revert PR — rollback is the one case where speed beats ceremony.
5. **Report** the revert commit SHA and what was undone.

Edge cases:

- **Rolling back several PRs:** revert newest-first (reverse merge order) so each revert applies cleanly.
- **Revert conflicts** (a later commit touched the same lines): stop and show the conflict; let the user decide rather than resolving silently.
- **Re-landing later:** the original branch still exists (no cleanup), so the work can come back via a fresh PR; reverting the revert also works.

## Notes

- Requires the `gh` CLI to be authenticated. If `gh` is missing or unauthenticated, surface that and stop.
- Do not create commits unless the user asks — this skill assumes the branch is ready.
- If a PR already exists for the branch, `gh pr create` will fail; in that case report the existing PR's URL and proceed to the merge offer for it.
