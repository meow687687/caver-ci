# caver-ci

**See how a change to a GitHub Actions trigger affects pull request eligibility.**

caver-ci compares two workflow files against pull request file changes. Use local fixtures for an offline check, or ask GitHub.com for recent public pull requests. It reads workflow YAML as data; it never runs workflow commands.

`GitHub.com only` · `Read-only` · `Token optional` · `Node 20.19+, 22.12+, or 24+`

> A `run` result means the supported trigger filters match the inputs. It does not say that a workflow ran, that a job passed, or that CI time was saved.

## Try it with the included fixtures

Requires Node.js 20.19+, 22.12+, or 24+ and npm. Clone the repository and build the compiled CLI:

```sh
git clone https://github.com/meow687687/caver-ci.git
cd caver-ci
npm ci
npm run build
```

Compare the example workflows with four sample pull requests:

```sh
node dist/cli.js analyze \
  --platform github.com \
  --base fixtures/base.yml \
  --proposed fixtures/proposed.yml \
  --prs fixtures/prs.json \
  --format text
```

The text report gives a count and reason for each result. The fixture is synthetic; no GitHub request is made.

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

JSON is the default output for scripts and keeps the fixture-mode shape used by earlier versions. Add `--format text` when you want a terminal summary.

To install the latest `main` build into `~/.local`, use the source installer. Review [`install.sh`](install.sh) first; add `~/.local/bin` to your `PATH` after installation.

```sh
curl -fsSL https://raw.githubusercontent.com/meow687687/caver-ci/main/install.sh | sh
```

## Check recent pull requests on GitHub

Pass local workflow files and the public repository to inspect. The example uses the included workflows; for a real comparison, point `--base` and `--proposed` at the two workflow files you want to compare.

```sh
env -u GITHUB_TOKEN node dist/cli.js analyze \
  --repo actions/checkout \
  --base fixtures/base.yml \
  --proposed fixtures/proposed.yml \
  --platform github.com \
  --limit 50 \
  --format text
```

Public access works without credentials. To use the higher authenticated API quota, set `GITHUB_TOKEN` in the process environment; do not put it in a command argument or commit it to a file. caver-ci does not print the token or include it in reports. Repository mode sends GitHub REST `GET` requests only.

The command samples up to 50 recently updated PRs by default; `--limit` accepts 1–100. JSON output remains the default and includes PR metadata and collection completeness. Use [`docs/github-api.md`](docs/github-api.md) for API, pagination, and authentication details.

## What the results mean

| Result | Meaning |
| --- | --- |
| **run** | The supported `pull_request` filters match the supplied data. |
| **skip** | A supported filter rules out the pull request. |
| **unknown** | The available data or workflow syntax is not enough for a safe decision. |

For the `pull_request` event, supported filters are activity `types`, `branches`, `branches-ignore`, `paths`, and `paths-ignore`. The glob syntax is intentionally narrower than GitHub's: literal patterns, `*` within a path segment, and `**` as a whole segment. Unsupported syntax returns `unknown`.

### Limits

- GitHub mode supports **public GitHub.com repositories only**. GitHub Enterprise Server is not supported.
- GitHub's PR file endpoint returns at most 3,000 files. Partial lists, missing relevant metadata, or a list that reaches this ceiling can make a path-filter result `unknown`.
- The REST PR record does not identify its historical event action or workflow version. Repository mode explicitly tests a hypothetical `pull_request: opened` event against the workflow files you supply now; it does not reconstruct past runs.
- Workflow jobs, `if` expressions, permissions, required checks, repository settings, outages, and actual execution are outside the analysis.

For offline input, pass a JSON array with `--prs`. Each record needs a unique `id`, `baseBranch`, `action`, `changedFiles`, and `filesComplete`; set `filesComplete` to `false` if the file list may be partial. Path decisions become `unknown` when that uncertainty matters. See [`fixtures/prs.json`](fixtures/prs.json) for a working example.

## Development

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md), the [architecture guide](docs/architecture.md), and the [validation report](validation/README.md). Synthetic fixtures and mocked API responses are test inputs, not observations of workflow execution.

Original caver-ci code and project-authored documentation are licensed under MIT. The linked upstream workflow snapshots in `validation/workflows/` retain their original rights; see [LICENSE](LICENSE) and [validation sources](validation/README.md).

The v0.3.0 npm package is private and is not published. Use the source checkout or installer above.
