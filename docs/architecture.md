# Architecture and maintenance

caver-ci compares GitHub.com `pull_request` trigger filters for two supplied workflow YAML files against offline PR fixtures or recent public GitHub.com PRs fetched through Octokit. Both modes are read-only; workflow commands are never executed. A `run` decision is trigger eligibility under the documented assumptions, not evidence of execution.

## Data flow

1. `src/cli.ts` requires `--platform`, `--base`, and `--proposed`, then selects exactly one data source: `--prs` for offline fixtures or `--repo owner/repository` for GitHub REST mode. JSON remains the default output format; `--format text` renders a human-readable summary and per-PR reasons without changing either JSON contract.
2. Fixture mode uses `parseFixtures` in `src/fixtures.ts` to validate the JSON array and unique fixture IDs. Its JSON output contract remains unchanged.
3. GitHub mode uses `src/github.ts` and official Octokit REST endpoints to verify public visibility, list PRs sorted by `updated` descending, and request changed-file pages. It preserves API order, honors a 1–100 PR limit, reads an optional token only from `GITHUB_TOKEN`, and sends GET requests only. A later PR-list page failure preserves earlier records and marks the collection incomplete; a first-page failure is a CLI error. Retries are limited to two, each request gets its own 10-second abort timeout, and rate-limit waits are capped at five seconds.
4. GitHub PR file results retain file status, previous names for renames, current PR/base metadata, and completeness. Removed files use the deleted path. A missing rename/status field or failed later page marks the file set incomplete. Reaching 3,000 file records is always incomplete because the REST endpoint cannot prove the full set at that boundary.
5. GitHub REST does not identify the historical event action, so this mode evaluates an explicitly labeled hypothetical `pull_request: opened` event. It compares current supplied workflow YAML against historical PR data; it does not reconstruct historical workflow configuration or execution.
6. `parseWorkflow` in `src/workflow.ts` parses YAML with duplicate-key checking, identifies the pull request trigger, and returns a validated, typed configuration or a conservative `unknown`/`skip` result. `analyzeWorkflow` in `src/analyzer.ts` checks supported activity types, branch filters, and path filters. Missing branch metadata returns `unknown` when a branch filter needs it.
7. `src/patterns.ts` uses picomatch with an intentionally limited syntax; ordered negative and positive patterns can exclude and re-include a path or branch. Each mode reports before/after decisions and a change classification. If either decision is `unknown`, the change is `unknown`.

The analyzer does not calculate diffs. Fixture callers supply the PR's base branch, activity, changed paths, and whether the file list is complete. GitHub mode fetches current PR metadata and file lists but cannot recover the original event action or workflow version. A branch or activity mismatch can establish `skip` before path evaluation; when path filters matter, incomplete files produce `unknown`. The API-derived list is marked incomplete at 3,000 files. Other platforms, including GitHub Enterprise Server, are unsupported.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/analyzer.ts` | Filter evaluation, decisions and reasons. |
| `src/fixtures.ts` | Validates fixture records and provides field-specific input errors. |
| `src/github.ts` | Octokit REST access, bounded retries/timeouts, PR and file pagination, provider metadata and completeness. |
| `src/workflow.ts` | Parses workflow YAML and validates the supported trigger configuration. |
| `src/patterns.ts` | Validates the supported glob subset and matches ordered patterns. |
| `src/cli.ts` | Command-line options, file reads, comparisons, JSON output and terminal report. |
| `eslint.config.js` | ESLint configuration for sources and tests. |
| `fixtures/` | Small example workflows and PR fixtures for the README quick start. |
| `test/` | Unit, boundary, mocked GitHub API, public-workflow fixture and CLI tests. |
| `validation/` | Pinned public workflow files, synthetic expectations and validation report. |
| `.github/workflows/quality.yml` | Runs build, typecheck, lint, tests, package smoke, and a scheduled dependency audit. |
| `install.sh` | Builds and installs the CLI to a user-local npm prefix. |
| `package.json` | Declares the CLI entry point, dependencies, commands, and supported Node.js engine range. |
| `CONTRIBUTING.md` | Development setup and local checks expected before pull requests. |
| `SECURITY.md` | Private vulnerability reporting guidance and product security scope. |
| `LICENSE` | MIT grant for original project code and documentation; upstream workflow snapshots are explicitly excluded. |
| `README.md` | Installation, usage, supported behavior and user-facing limitations. |

## Validation commands

`npm run lint` checks TypeScript source and tests with ESLint. `npm pack --dry-run` invokes `prepack`, which builds `dist/` before npm applies the `files` allowlist. The package ships only compiled runtime modules, `package.json`, and npm's automatically included README and LICENSE; tests, fixtures, credentials, and development configuration stay out. Install the generated tarball into an isolated project and run the `caver-ci` bin link to check the compiled CLI and package entrypoint.

The terminal report groups each comparison as newly skipped, newly triggered, unchanged, or unknown; these are trigger-filter classifications, not observed workflow execution or guaranteed savings. The JSON format remains the default to preserve existing consumers.

## Development and verification

```sh
npm ci
npm run build
npm run typecheck
npm run lint
npm test
npm pack --dry-run
```

For a manual check, run the sample command in the [README](../README.md#quick-start). `test/cli.test.ts` also checks that the CLI does not modify its inputs or run a workflow command, and that invalid fixture fields produce actionable errors. CI runs typecheck, build, lint, and tests on the supported Node.js minimums, installs the packed CLI into a temporary prefix and runs the documented example, and audits locked dependencies weekly. The [validation report](../validation/README.md) describes the synthetic oracle, supported and unsupported cases, and the GitHub.com/GitHub Enterprise Server diff-limit distinction. Its scenarios are not observed GitHub runs.

When changing trigger behavior, check the [official GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and add focused tests. Preserve conservative `unknown` results when behavior cannot be established. Document source assumptions and any discrepancy; do not describe synthetic tests as proof of GitHub-equivalent behavior.

## Keeping documentation current

Update documentation in the same change as the behavior it describes:

- **CLI, installation, fixture shape or supported filters:** update the README examples, options, and limitations.
- **Evaluation, modules or data flow:** update this architecture guide.
- **Test cases, GitHub semantics or validation claims:** update the [validation report](../validation/README.md), including the evidence source and any mismatches.
- **New or changed commands:** run the documented commands and update their expected output when needed.

Keep the documentation concise and explicit about uncertainty. A documentation update should not require copying an entire implementation or creating a new file for every change.
