# caver-ci v0.1

A read-only comparison of GitHub Actions `pull_request` trigger eligibility for historical PR fixtures. It parses YAML as data and never runs workflow commands. A `run` result means the supported trigger filters match the supplied fixture; `skip` means those filters do not match. Both are conditional on accurate inputs and the limitations below. `unknown` means the analyzer cannot decide. None proves whether GitHub executed a workflow or a job passed.

## Usage

Requires Node.js 20.19+ and npm.

```sh
npm ci
npm run build
node dist/cli.js analyze --base fixtures/base.yml --proposed fixtures/proposed.yml --prs fixtures/prs.json
npm test
npm run typecheck
```

The CLI prints JSON with each fixture's `before` and `after` decision and reason. `change` is `unchanged`, `run -> skip`, `skip -> run`, or `unknown` if either side is unknown. Invalid input files or fixture JSON cause a nonzero exit; an uncertain workflow decision is reported in JSON, not treated as a CLI error.

Fixtures are a JSON array, for example:

```json
[{ "id": "PR-1", "baseBranch": "main", "action": "opened", "changedFiles": ["src/app.ts"], "filesComplete": true }]
```

`id` must be unique. `baseBranch` is the PR's target branch, `action` is the actual GitHub pull request activity type, and `changedFiles` contains repository-relative paths from the PR diff. Set `filesComplete` to `false` if the list is incomplete; path-filtered decisions then return `unknown`. The caller is responsible for collecting accurate historical data and providing a complete list. No GitHub access is performed.

## Scope and limitations

- Supports `on` as a string, event list, or mapping, and `pull_request` activity `types`, `branches`, `branches-ignore`, `paths`, and `paths-ignore`. Branch and path filters both must match. Default activity types are `opened`, `synchronize`, and `reopened`.
- Patterns support literal characters, `*` within a path segment, `**` as a whole segment, and ordered `!` exclusions and re-inclusions in positive filter lists. At least one positive pattern is required. Ignore lists use positive patterns. Unsupported syntax, including `?`, character classes, braces, escapes, and extglobs, returns `unknown`; this is intentionally narrower than GitHub's pattern language.
- An empty complete changed-file list does not match a path filter. An incomplete list or a list over 3,000 files is unknown when paths matter. GitHub uses a three-dot PR diff and documents a 3,000-file evaluation limit and diff-timeout behavior; these are not fully simulated, and even a complete fixture may differ from GitHub's evaluated file set. Supply the exact relevant file set when possible.
- Only the `pull_request` event is analyzed. Other events, including `pull_request_target`, do not establish eligibility for this event. Unsupported PR options, activity types, YAML aliases, malformed YAML, and unsupported patterns yield `unknown` where encountered.
- This does not validate all workflow schema, evaluate jobs or `if` expressions, required checks, permissions, concurrency, repository settings, workflow availability, GitHub outages, or actual runs. Results depend on fixture accuracy and should not be used as proof of safety.

GitHub references: [workflow syntax and filter patterns](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpull_requestpull_request_targetbranchesbranches-ignore), [path filtering and diff limits](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons), and [pull request events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request).
