# Git Policy

Status: Active

## Applicability

This policy applies from this point forward.

Earlier history reflects the initial private bring-up phase. Do not rewrite old history to pretend it followed rules
that did not exist yet.

## Branches

`main` is the stable milestone branch.

`dev` is the integration branch. It must remain buildable and must pass repository verification.

All implementation work happens on short-lived branches:

- `feature/<area>-<short-name>`
- `fix/<area>-<short-name>`
- `docs/<area>-<short-name>`
- `chore/<area>-<short-name>`

Do not commit directly to `main`.

Do not commit directly to `dev` except for explicit maintainer-controlled integration work.

## Commit ownership

The human maintainer owns commit boundaries.

Agents may edit files, run validation, and suggest commit messages. Agents must not commit, push, merge, rewrite
history, or create release tags unless explicitly instructed.

Agent reports must include:

- exact files changed
- validation commands run
- validation result
- remaining risks
- suggested commit message

## Commit messages

Use Conventional Commit shape:

`type(scope): summary`

The scope is required.

Allowed types:

- `feat`
- `fix`
- `refactor`
- `docs`
- `test`
- `chore`
- `ci`
- `build`
- `perf`
- `revert`

Preferred scopes:

- `base`
- `schema`
- `compiler`
- `hot-codec`
- `hot-consumer`
- `hot-publisher`
- `hot-binding`
- `hot-publication`
- `conformance`
- `session`
- `control-plane`
- `resource`
- `warm`
- `host-contract`
- `fixtures`
- `docs`
- `tooling`
- `repo`
- `release`

Scopes must describe package or repo ownership.

Do not use placeholder scopes such as `core`, `integration`, `runtime`, `app`, `electron`, or `worklet` unless a package
or repo layer with that ownership exists.

Examples:

- `feat(conformance): prove fixture-backed hot exchange`
- `fix(repo): normalize line endings`
- `ci(repo): add commitlint`
- `docs(repo): add git policy and PR template`
- `chore(release): promote hot exchange conformance proof`

## Pull requests

Every non-trivial change should enter `dev` through a PR or explicit local review checkpoint.

A PR must state:

- goal
- package or repo-layer ownership
- non-goals
- tests or fixtures added
- generated artifacts changed, if any
- validation run
- remaining risks

## Generated artifacts

Generated artifacts must not be hand-edited.

A change that updates generated fixture artifacts must also update or run the generator that owns those artifacts.

PRs that touch generated artifacts must state:

- the generator command used
- why the artifacts changed

## Merge rules

Feature branches may have messy local history.

Before merging to `dev`, squash noisy branches into one principled commit when the intermediate commits do not carry
useful review history.

Promote `dev` to `main` only at meaningful milestones.

Milestone promotion commits must use scoped Conventional Commit form, for example:

`chore(release): promote hot exchange conformance proof`

## Validation

Before merging into `dev` or `main`, run:

```sh
pnpm verify
git diff --check
```

Commit messages are checked with commitlint.

The Windows checkout at `C:\dev\projection-runtime` is authoritative for this
project. Do not route Projection Runtime validation through WSL.

## Filename conventions

Package source and test files must use kebab-case:

- `packages/<scope>/src/<name>.ts`
- `packages/<scope>/tests/<name>.test.ts`

Exceptions:

- `index.ts` at the package root is allowed as an entry point.
- Generated files under `fixtures/**/generated/**` are owned by their generators and are exempt.
- Configuration files may use whatever convention their tooling requires.

Documentation files under `docs/` must use kebab-case, except `README.md`.

`scripts/check-file-names.mts` enforces this convention during `pnpm verify`.

## Automation policy

GitHub Actions are not enabled by default.

Repository automation must be added deliberately and reviewed as security-sensitive code.

A workflow may not:

- use repository secrets unless the workflow has a specific release or deployment purpose
- use `pull_request_target`
- grant write permissions by default
- run third-party actions casually
- publish artifacts, packages, or releases without explicit maintainer review

If GitHub Actions are introduced later, they must use least-privilege permissions and avoid secrets for validation-only
workflows.

## Enforcement

Repository policy is enforced through:

- review discipline
- commitlint
- `pnpm verify`
- `git diff --check`
- branch protection rules, when configured
