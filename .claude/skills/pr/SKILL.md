---
name: pr
description: "Create a GitHub pull request for the current feature branch. Use when the user asks to open/create a PR, or types /pr. Pushes the branch and opens a PR against main with a generated title and body."
---

# /pr — Open a Pull Request

Create a GitHub PR for the current (pre-existing) feature branch. Keep it lightweight.

## Steps

1. **Gather context** in one batch:
   - `git rev-parse --abbrev-ref HEAD` — current branch (abort if it's `main`; tell the user to switch to a feature branch).
   - `git status --short` — warn if there are uncommitted changes; ask whether to commit them first or proceed.
   - `git log main..HEAD --oneline` — commits that will be in the PR.
   - `git diff main...HEAD --stat` — files changed.

2. **Push the branch** with upstream tracking: `git push -u origin HEAD`.

3. **Create the PR** with `gh pr create --base main`:
   - Title: a concise summary of the branch's changes (Conventional Commits style if the repo uses it, e.g. `feat:`, `fix:`).
   - Body: a short summary section and a bullet list of key changes, derived from the commits/diff. Use a heredoc for the body.
   - End the PR body with:
     ```
     🤖 Generated with [Claude Code](https://claude.com/claude-code)
     ```

4. **Report** the PR URL back to the user.

## Notes

- Requires the `gh` CLI to be authenticated. If `gh` is missing or unauthenticated, surface that and stop.
- Do not create commits unless the user asks — this skill assumes the branch is ready.
- If a PR already exists for the branch, `gh pr create` will fail; in that case report the existing PR (`gh pr view --web` or its URL) instead.
