# Projection Runtime Branch Workflow

Status: Active working convention

## 1. Start a new slice

Always branch from `dev`.

```sh
git checkout dev
git pull origin dev
git checkout -b feature/<slice-name>
```

Examples:

```text
feature/hot-publisher-generated-writer
feature/hot-binding
feature/generated-hot-artifact-manifest
```

## 2. Agent workflow

Agents may:

- edit files
- run validation
- report exact files changed
- suggest a commit message

Agents must not:

- commit
- push
- merge

The human maintainer owns:

- branch creation
- commit boundaries
- commit messages
- merge decisions
- branch deletion
- promotion to `main`

## 3. Implementation validation loop

Use these while working on a feature branch:

```sh
pnpm verify
git diff --check
pnpm exec commitlint --from origin/dev --to HEAD --verbose
```

Focused package validation when useful:

```sh
pnpm --filter @exclave/<package> test
pnpm exec vitest run packages/<package>/tests/<package>.test.ts
```

If the slice touches fixture generation:

```sh
node scripts/write-projection-runtime-fixture.mts
```

## 4. Commit policy

Commit message shape:

```text
type(scope): summary
```

Examples:

```text
feat(hot-binding): bind hot regions to ABI counter views
fix(hot-publisher): reject invalid counter inputs
refactor(conformance): share generated hot artifact helpers
```

If a new package lands, update both:

```text
commitlint.config.ts
docs/development/git-policy.md
```

Do not lie with a broader scope just because commitlint has not caught up yet.

## 5. Pre-merge branch review

Before merging a feature branch into `dev`, run:

```sh
git checkout feature/<slice-name>
git pull origin feature/<slice-name>
pnpm verify
git diff --check
pnpm exec commitlint --from origin/dev --to HEAD --verbose
```

Review checklist:

- package ownership is still clean
- no fake `core` package creep
- no lifecycle creep
- no naming lies
- generated artifacts are deterministic
- commit scopes are honest
- branch is ahead of `dev` only by the intended commits

## 6. Merge feature branch into dev

Use a merge commit, not fast-forward.

```sh
git checkout dev
git pull origin dev
git merge --no-ff feature/<slice-name> -m "chore(release): integrate <milestone>"
pnpm verify
git diff --check
git push origin dev
```

Examples:

```text
chore(release): integrate hot publisher generated writer proof
chore(release): integrate hot binding package
```

## 7. Delete merged feature branch

Only after `dev` is pushed cleanly.

```sh
git branch -d feature/<slice-name>
git push origin --delete feature/<slice-name>
```

## 8. Promote dev to main

Promote only at meaningful milestones.

```sh
git checkout main
git pull origin main
git merge --no-ff dev -m "chore(release): promote <milestone>"
pnpm verify
git diff --check
git push origin main
```

Examples:

```text
chore(release): promote hot publisher generated writer proof
chore(release): promote hot binding package
```

## 9. Re-sync dev after promotion

After `main` is promoted, bring `dev` back to the same point.

```sh
git checkout dev
git merge main
git push origin dev
```

Goal: `main` and `dev` should be identical again after promotion.

## 10. Branch roles

```text
main
  stable milestone branch

dev
  integration branch
  must stay buildable
  must pass pnpm verify

feature/<slice>
  short-lived implementation branch
  local work and review
  merge into dev
  delete after merge
  promote dev to main at milestone
```

## 11. Commands we run most often

Start slice:

```sh
git checkout dev
git pull origin dev
git checkout -b feature/<slice-name>
```

Validate:

```sh
pnpm verify
git diff --check
pnpm exec commitlint --from origin/dev --to HEAD --verbose
```

Merge to dev:

```sh
git checkout dev
git pull origin dev
git merge --no-ff feature/<slice-name> -m "chore(release): integrate <milestone>"
pnpm verify
git diff --check
git push origin dev
```

Delete feature branch:

```sh
git branch -d feature/<slice-name>
git push origin --delete feature/<slice-name>
```

Promote to main:

```sh
git checkout main
git pull origin main
git merge --no-ff dev -m "chore(release): promote <milestone>"
pnpm verify
git diff --check
git push origin main
```

Re-sync dev:

```sh
git checkout dev
git merge main
git push origin dev
```

## 12. Non-negotiable invariants

- no direct commits to `main`
- no direct commits to `dev` except explicit maintainer integration work
- feature branches are short-lived
- agents do not commit or push
- package scopes must stay honest
- generated artifacts are not hand-edited
- `dev` must pass verification before promotion
- `main` and `dev` should be identical after milestone promotion
- no fake `core`, runtime, lifecycle, app, Electron, or worklet ownership creep
