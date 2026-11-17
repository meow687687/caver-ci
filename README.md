# caver-ci

**See how a workflow change affects pull request trigger eligibility.**

caver-ci compares two GitHub Actions workflow files against pull request fixtures and explains which triggers match, which do not, and which cannot be determined. It reads YAML as data and never executes workflow commands.

`GitHub.com` · `Read-only` · `No API required` · `v0.1`

> [!IMPORTANT]
> A `run` decision means the supported trigger filters match the supplied fixture. It does **not** prove that a workflow ran or that a job passed. Results depend on accurate inputs and the limitations below.

---

## How it works

```text
Original workflow ─┐
                   ├─ compare against PR fixtures ──► before / after decisions
Proposed workflow ─┘
```

| Decision | Meaning |
| --- | --- |
| **run** | The supported trigger filters match the fixture. |
| **skip** | The supported trigger filters do not match the fixture. |
| **unknown** | The analyzer cannot safely determine eligibility. |

## Install

Requires Git, npm, and **Node.js 20.19+, 22.12+, or 24+**. Install into `~/.local` without sudo:

```sh
curl -fsSL https://raw.githubusercontent.com/meow687687/caver-ci/main/install.sh | sh
```

Ensure `~/.local/bin` is on your `PATH`. To install elsewhere, use `curl -fsSL https://raw.githubusercontent.com/meow687687/caver-ci/main/install.sh | CAVER_CI_PREFIX="$HOME/my-prefix" sh`. The installer downloads the current `main` branch, installs build dependencies, and builds the CLI. To inspect the script before running it, [read install.sh](install.sh).

## Quick start

For a local checkout, install dependencies and build:

```sh
npm ci
npm run build
```

Run the included example from the checkout (use `caver-ci` in place of `node dist/cli.js` after installing):

```sh
node dist/cli.js analyze \
  --platform github.com \
  --base fixtures/base.yml \
  --proposed fixtures/proposed.yml \
  --prs fixtures/prs.json
```

The included example compares four PR fixtures. The JSON output includes each decision and its reason, plus the change between them:

| Fixture | Before | After | Change |
| --- | --- | --- | --- |
| PR-101 | run | run | unchanged |
| PR-102 | run | skip | run → skip |
| PR-103 | skip | run | skip → run |
| PR-104 | unknown | unknown | unknown |

The CLI reports both the requested `platform` and `supportedPlatform`. The required `--platform` value must identify the actual target. Only `github.com` is supported; other values, including GitHub Enterprise Server, produce `unknown` decisions. Invalid input files or fixture JSON cause a nonzero exit. An uncertain decision is reported in JSON rather than treated as a CLI error.

Invalid fixture records report the array index and the field that needs correction.

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

The caller is responsible for collecting accurate historical data. Set `filesComplete` to `false` when the list is incomplete; path-filtered decisions then return `unknown` when the file list matters. caver-ci does not contact GitHub.

## Supported behavior

- `pull_request` triggers expressed as a string, event list, or mapping.
- Activity `types`, `branches`, `branches-ignore`, `paths`, and `paths-ignore`. Branch and path filters must both match when both are present. The default activity types are `opened`, `synchronize`, and `reopened`.
- Literal patterns, `*` within a path segment, and `**` as a whole segment. Positive filter lists support ordered `!` exclusions and re-inclusions and require at least one positive pattern; ignore lists use positive patterns.

Unsupported syntax—including `?`, character classes, braces, escapes, and extglobs—returns `unknown`. This is a narrower pattern language than GitHub's.

## Limits to keep in mind

- **Platform:** Only GitHub.com is supported. GitHub Enterprise Server 3.19 documents a different diff limit and must not be declared as GitHub.com.
- **Changed files:** An empty complete list does not match a path filter. An incomplete list or a list over 3,000 files is `unknown` when paths matter. Fixture order is not assumed to match GitHub diff order. At or below 3,000 files, results assume the fixture contains the complete relevant three-dot PR diff.
- **Server behavior:** Diff timeouts and other server-side exceptions are not simulated. A fixture may differ from the diff GitHub evaluates.
- **Workflow coverage:** Only `pull_request` is analyzed. Other events, including `pull_request_target`, do not establish eligibility for this event. Unsupported PR options, activity types, YAML aliases, and malformed YAML return `unknown` where encountered.
- **Execution:** Workflow schema, jobs, `if` expressions, required checks, permissions, concurrency, repository settings, workflow availability, outages, and actual runs are not fully evaluated. Results are not proof of safety.

GitHub references: [workflow syntax and filter patterns](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpull_requestpull_request_targetbranchesbranches-ignore) · [path filtering and diff limits](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons) · [pull request events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request)

## Validation & development

```sh
npm run build
npm run typecheck
npm test
```

Pull requests run type checking, build, and tests on the supported Node.js minimums. A separate package smoke job installs the packed CLI in a temporary prefix and runs the README example. CI audits the locked dependency tree weekly.

The [validation report](validation/README.md) records manual expectations for synthetic fixtures against five pinned public workflows, the diff-limit boundary tests, and known risks. It does **not** compare against observed GitHub executions.

For the code layout, data flow, and documentation maintenance guidance, see the [architecture and maintenance guide](docs/architecture.md).
