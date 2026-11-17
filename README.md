# caver-ci

**Compare how two GitHub Actions workflow files match pull request trigger filters.**

caver-ci evaluates the `pull_request` trigger against local fixtures or recent pull requests from a public GitHub.com repository. It reads workflow YAML as data; it never executes a workflow or changes a repository.

`GitHub.com only` · `Read-only` · `Token optional` · `Node 20.19+, 22.12+, or 24+`

| Mode | Input | Network |
| --- | --- | --- |
| Offline | Workflow files and a PR fixture JSON file | None |
| Repository | Workflow files and `owner/repository` | Public GitHub REST API |

> **Interpret results as filter eligibility.** `run` does not mean that GitHub ran the workflow, that a job passed, or that CI time was saved.

## Quick start

Requires Node.js 20.19+, 22.12+, or 24+ and npm. Build from a source checkout:

```sh
git clone https://github.com/meow687687/caver-ci.git
cd caver-ci
npm ci
npm run build
```

Try the included offline example:

```sh
node dist/cli.js analyze \
  --platform github.com \
  --base fixtures/base.yml \
  --proposed fixtures/proposed.yml \
  --prs fixtures/prs.json \
  --format text
```

The sample uses four synthetic pull requests and makes no GitHub request. The text report looks like this:

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

JSON is the default and remains compatible with the fixture-mode format used by earlier versions. Add `--format text` for a terminal summary.

## Analyze a public repository

Pass two workflow files available on your machine and the GitHub repository whose pull requests you want to inspect:

```sh
node dist/cli.js analyze \
  --repo actions/checkout \
  --base path/to/original.yml \
  --proposed path/to/proposed.yml \
  --platform github.com \
  --limit 50 \
  --format text
```

The default sample is the 50 most recently updated pull requests, open or closed; `--limit` accepts 1–100. caver-ci preserves GitHub's returned order and reports if the sample is limited or incomplete. Public reads work without credentials:

```sh
env -u GITHUB_TOKEN node dist/cli.js analyze \
  --repo actions/checkout \
  --base path/to/original.yml \
  --proposed path/to/proposed.yml \
  --platform github.com
```

For a higher API quota, set `GITHUB_TOKEN` in the process environment. Do not put a token in an argument or commit it to a file. The CLI does not print it or include it in reports. Requests use GitHub REST `GET` endpoints only.

For an install into `~/.local`, the source installer clones `main`, builds the CLI, and installs it without `sudo`. Review [`install.sh`](install.sh) before running it; add `~/.local/bin` to your `PATH` afterward. Set `CAVER_CI_PREFIX` to choose another install prefix.

```sh
curl -fsSL https://raw.githubusercontent.com/meow687687/caver-ci/main/install.sh | sh
```

The v0.3.0 npm package is private and is not published. caver-ci is installed from a source checkout or with the source installer.

## Read the results

| Result | Meaning |
| --- | --- |
| **run** | The supported filters match the supplied inputs. |
| **skip** | A supported filter rules out the pull request. |
| **unknown** | The workflow syntax or available data is insufficient for a safe decision. |

The text summary counts comparisons as newly skipped, newly triggered, unchanged, or unknown. It includes one row per pull request with the decisions and a concise reason. A comparison is unknown if either workflow's decision is unknown. JSON stays the default for scripts and includes per-decision reasons; GitHub mode also includes PR metadata and collection completeness.

## Inputs and supported filters

Use `--prs fixtures/prs.json` for offline analysis. The input is a JSON array; each record needs a unique ID, base branch, activity, changed paths, and a completeness flag:

```json
{
  "id": "PR-42",
  "baseBranch": "main",
  "action": "opened",
  "changedFiles": ["src/app.ts"],
  "filesComplete": true
}
```

Only the `pull_request` trigger is evaluated. Supported options are `types`, `branches`, `branches-ignore`, `paths`, and `paths-ignore`. With no `types` filter, GitHub's default activities are `opened`, `synchronize`, and `reopened`. The supported glob subset includes literal patterns, `*` within a path segment, and `**` as a complete segment. Ordered exclusions and re-inclusions are supported in positive filter lists.

Unsupported trigger options, malformed YAML, aliases, unsupported activities, and unsupported glob syntax produce `unknown` where encountered. The pattern language is narrower than GitHub's; see the [architecture guide](docs/architecture.md) for implementation details.

## Limits and assumptions

- **Platform:** Repository mode accepts public GitHub.com repositories only. GitHub Enterprise Server and other forges are unsupported.
- **Historical context:** GitHub's PR API does not identify the event action or workflow version from when a PR was opened. Repository mode tests the explicit hypothetical action `pull_request: opened` using the workflow files supplied now. It does not reconstruct historical runs.
- **Changed files:** The REST endpoint caps a PR file listing at 3,000. Failed or partial pages, missing rename/status data, or reaching the cap make path-filter results unknown when completeness matters. Renames contribute both old and new paths; deleted files contribute their deleted path.
- **What is evaluated:** caver-ci checks supported trigger filters. It does not evaluate jobs, `if` expressions, permissions, required checks, repository settings, outages, or actual workflow execution.
- **API limits:** Requests time out after 10 seconds, transient failures get at most two retries, and rate-limit waits are capped at five seconds. A failure while collecting later PR pages preserves earlier results and marks the sample incomplete.

## Develop and validate

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
```

The CLI is TypeScript compiled to `dist/`; GitHub access uses Octokit, workflow YAML is parsed with `yaml`, and trigger patterns use `picomatch`. The code map, data flow, and maintenance notes are in [`docs/architecture.md`](docs/architecture.md). See [`docs/github-api.md`](docs/github-api.md) for API behavior and [`validation/README.md`](validation/README.md) for synthetic and mocked validation evidence.

Report security issues using [`SECURITY.md`](SECURITY.md). Original caver-ci code and project-authored docs are MIT licensed; copied workflow snapshots in `validation/workflows/` keep their original rights. See [`LICENSE`](LICENSE) and the source links in the validation report.
