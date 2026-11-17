# caver-ci

**See how a workflow change affects pull request trigger eligibility.**

caver-ci compares two supplied GitHub Actions workflow files against either offline pull request fixtures or recent public GitHub.com pull requests. It reads YAML as data, uses the official GitHub REST API in repository mode, and never executes workflow commands.

`GitHub.com` · `Read-only` · `Optional GITHUB_TOKEN` · `v0.3`

> [!IMPORTANT]
> A `run` decision means the supported trigger filters match the supplied inputs under the stated scenario. It does **not** prove that a workflow ran or that a job passed. Repository mode is a hypothetical evaluation of the supplied workflow configurations against historical PR file changes. It does **not** reconstruct the workflow configuration or execution that existed when each PR was opened.

---

## How it works

```text
Original workflow ─┐
                   ├─ compare against ────┬─ offline PR fixtures
                   │                      └─ public GitHub PRs ──► before / after decisions
Proposed workflow ─┘
```

| Decision | Meaning |
| --- | --- |
| **run** | The supported trigger filters match the fixture. |
| **skip** | The supported trigger filters do not match the fixture. |
| **unknown** | The analyzer cannot safely determine eligibility. |

## Prerequisites and install

Requires **Node.js 20.19+, 22.12+, or 24+**, npm, and Git for a source checkout. No GitHub token is needed for offline fixtures or public repository reads. The original caver-ci code and documentation use the MIT License in [LICENSE](LICENSE); copied upstream validation workflows retain their original rights. The v0.3.0 npm package remains private and is not being published.

The install script installs the latest `main` branch into `~/.local` without sudo:

```sh
curl -fsSL https://raw.githubusercontent.com/meow687687/caver-ci/main/install.sh | sh
```

Ensure `~/.local/bin` is on your `PATH`. To install elsewhere, use `curl -fsSL https://raw.githubusercontent.com/meow687687/caver-ci/main/install.sh | CAVER_CI_PREFIX="$HOME/my-prefix" sh`. The installer downloads the current `main` branch, installs build dependencies, and builds the CLI. To inspect the script before running it, [read install.sh](install.sh).

## Quick start

Clone the repository, install its locked dependencies, and build the compiled CLI:

```sh
git clone https://github.com/meow687687/caver-ci.git
cd caver-ci
npm ci
npm run build
```

Run the offline example from the checkout. The command uses the compiled `dist/cli.js`; JSON is the default for scripts, and `--format text` prints a terminal summary:

```sh
node dist/cli.js analyze \
  --platform github.com \
  --base fixtures/base.yml \
  --proposed fixtures/proposed.yml \
  --prs fixtures/prs.json \
  --format text
```

The included example compares four PR fixtures. The text summary shows the input scope, platform, sample size, counts for newly skipped, newly triggered, unchanged, and unknown results, followed by each PR identifier and concise reason. An empty sample is reported explicitly. Example output:

```text
caver-ci · workflow trigger comparison
Evaluated repo: offline fixtures (repository not specified)
Platform: github.com
Sample size: 4
Newly skipped: 1 · Newly triggered: 1 · Unchanged: 1 · Unknown: 1

Results:
  #PR-101  run → run  (unchanged) — Pull request trigger filters match
  #PR-102  run → skip  (newly skipped) — No changed file matches paths
  #PR-103  skip → run  (newly triggered) — Pull request trigger filters match
  #PR-104  unknown → unknown  (unknown) — Changed file list is incomplete
```

JSON remains the default and includes each decision and its reason, plus the change between them:

| Fixture | Before | After | Change |
| --- | --- | --- | --- |
| PR-101 | run | run | unchanged |
| PR-102 | run | skip | run → skip |
| PR-103 | skip | run | skip → run |
| PR-104 | unknown | unknown | unknown |

The CLI reports both the requested `platform` and `supportedPlatform`. The required `--platform` value must identify the actual target. Only `github.com` is supported; other values, including GitHub Enterprise Server, produce `unknown` decisions. Invalid input files or fixture JSON cause a nonzero exit. An uncertain decision is reported in JSON rather than treated as a CLI error.

Invalid fixture records report the array index and the field that needs correction.

## Analyze a public GitHub repository

Repository mode lists recent pull requests, retrieves each PR's changed files, then evaluates both supplied workflow files against that historical file list. It is read-only and sends only `GET` requests.

```sh
caver-ci analyze \
  --repo actions/checkout \
  --base .github/workflows/original.yml \
  --proposed .github/workflows/optimized.yml \
  --platform github.com \
  --limit 50
```

`--limit` defaults to 50 and accepts 1 through 100. Pull requests are requested in GitHub's `updated` descending order; caver-ci keeps the API order and reports whether more PRs were available beyond the requested limit. It does not sort PRs by number or claim that a limited sample is the full repository history.

Public repository access does not require a token. This unauthenticated command uses the public API:

```sh
env -u GITHUB_TOKEN caver-ci analyze \
  --repo actions/checkout \
  --base fixtures/base.yml \
  --proposed fixtures/proposed.yml \
  --platform github.com \
  --format text
```

For a higher API rate limit, an optional `GITHUB_TOKEN` can read public repository metadata and pull requests. Prompt for it without adding it to shell history, then run the same command:

```sh
# Bash: enter the token without echoing it or saving it in shell history.
read -rsp 'GitHub token: ' GITHUB_TOKEN; printf '\n'
export GITHUB_TOKEN
caver-ci analyze --repo actions/checkout --base fixtures/base.yml --proposed fixtures/proposed.yml --platform github.com
unset GITHUB_TOKEN
```

caver-ci does not print the token or include it in JSON or text reports. A token is optional; the README examples and offline quickstart do not require a real token.

The GitHub REST pull request resource does not identify which historical `pull_request` action fired. Repository mode therefore explicitly evaluates the hypothetical `pull_request: opened` action and labels that assumption in JSON. A PR's current state, base branch, timestamps, draft/merged metadata, and file list are reported when the API provides them. Missing base branch metadata yields `unknown` when a branch filter depends on it.

Repository-mode JSON includes collection scope (`requestedLimit`, `pullRequestListComplete`, `pullRequestListHasMore`), PR metadata, changed-file count and completeness, and per-workflow decisions. An empty PR list is reported as empty. If a file request fails or metadata is incomplete, the path-filter decision is `unknown` where changed paths matter. The exact 3,000-file boundary is incomplete because GitHub's REST files endpoint cannot establish whether more files were omitted. caver-ci stops at that limit and does not infer that a returned file represents GitHub Actions' own diff evaluation.

If a later PR-list page fails after earlier records were collected, caver-ci reports the collected sample and marks the PR list incomplete. A failure before any PR records can be collected is reported as a CLI error. `--format text` displays the evaluated repository and a collection note for incomplete or limited samples; `--format json` remains the default and preserves the existing JSON contracts.

API requests have an independent 10-second timeout, at most two retries for transient errors, and bounded waits for rate limits. Authentication errors, permission errors, exhausted rate limits, missing public repositories, and network failures produce sanitized CLI errors; response bodies, authorization headers, and tokens are not printed. Repository mode supports GitHub.com public repositories only, not GHES.

See [GitHub REST mode](docs/github-api.md) for endpoint, authentication, pagination, retry, and completeness details.

## Bring your own fixtures

Pass a JSON array of pull requests with `--prs`:

```json
[
  {
    "id": "PR-1",
    "baseBranch": "main",
    "action": "opened",
    "changedFiles": ["src/app.ts"],
    "filesComplete": true
  }
]
```

| Field | Description |
| --- | --- |
| `id` | Unique fixture identifier. |
| `baseBranch` | The PR's target branch. |
| `action` | The actual pull request activity type, such as `opened`. |
| `changedFiles` | Repository-relative paths from the PR diff. |
| `filesComplete` | Whether the supplied list contains the complete relevant diff. |

Fixture mode remains offline and does not contact GitHub. The caller is responsible for collecting accurate data. Set `filesComplete` to `false` when the list is incomplete; path-filtered decisions then return `unknown` when the file list matters.

## Supported behavior

- `pull_request` triggers expressed as a string, event list, or mapping.
- Activity `types`, `branches`, `branches-ignore`, `paths`, and `paths-ignore`. Branch and path filters must both match when both are present. The default activity types are `opened`, `synchronize`, and `reopened`.
- Literal patterns, `*` within a path segment, and `**` as a whole segment. Positive filter lists support ordered `!` exclusions and re-inclusions and require at least one positive pattern; ignore lists use positive patterns.

Unsupported syntax—including `?`, character classes, braces, escapes, pipes, and extglobs—returns `unknown`. This is a narrower pattern language than GitHub's.

## Limits to keep in mind

- **Platform:** Only GitHub.com is supported. GitHub Enterprise Server 3.19 documents a different diff limit and must not be declared as GitHub.com.
- **Changed files:** An empty complete list does not match a path filter. In repository mode, an incomplete list or a list that reaches 3,000 files is `unknown` when paths matter. The REST endpoint returns at most 3,000 PR files; reaching exactly 3,000 does not prove completeness. Renamed files include old and new paths; deleted files retain their deleted path. Missing rename/status metadata marks the list incomplete. Fixture order is not assumed to match GitHub's workflow diff order.
- **Historical data:** Supplied workflow files are evaluated against PR data fetched now. caver-ci does not retrieve historical workflow versions, event delivery payloads, or actual workflow runs. The repository-mode `opened` action is an explicit hypothetical scenario.
- **Rate limits:** Unauthenticated and authenticated GitHub API quotas differ. Retries are bounded; if GitHub's requested wait exceeds the local cap, caver-ci reports the limit rather than waiting indefinitely.
- **Workflow coverage:** Only `pull_request` is analyzed. Other events, including `pull_request_target`, do not establish eligibility for this event. Unsupported PR options, activity types, YAML aliases, and malformed YAML return `unknown` where encountered.
- **Execution:** Workflow schema, jobs, `if` expressions, required checks, permissions, concurrency, repository settings, workflow availability, outages, and actual runs are not fully evaluated. Results are not proof of safety.

GitHub references: [workflow syntax and filter patterns](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpull_requestpull_request_targetbranchesbranches-ignore) · [path filtering and diff limits](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons) · [pull request events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)

## Validation & development

```sh
npm run build
npm run typecheck
npm test
```

Pull requests run type checking, build, lint, and tests on the supported Node.js minimums. A separate package smoke job installs the packed CLI in a temporary prefix and runs the README example. CI audits the locked dependency tree weekly.

The [validation report](validation/README.md) records manual expectations for synthetic fixtures against five pinned public workflows, the diff-limit boundary tests, and known risks. It does **not** compare against observed GitHub executions.

`npm run lint` runs ESLint over the TypeScript sources, tests, and ESLint configuration. CLI output is descriptive analysis of supplied inputs and is not evidence of actual workflow execution or guaranteed CI savings.

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and pull request checks. Report security issues using the private reporting guidance in [SECURITY.md](SECURITY.md).

For the code layout, data flow, and documentation maintenance guidance, see the [architecture and maintenance guide](docs/architecture.md).
