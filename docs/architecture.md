# Architecture and maintenance

caver-ci compares GitHub.com `pull_request` trigger filters for two workflow YAML files against supplied PR fixtures. It is a read-only, offline analyzer: workflow commands are never executed, and it does not contact GitHub. A `run` decision is trigger eligibility under the documented assumptions, not evidence of execution.

## Data flow

1. `src/cli.ts` uses Commander to require `--platform`, `--base`, `--proposed`, and `--prs`, then reads the three input files.
2. `parseFixtures` in `src/fixtures.ts` validates the JSON array and unique fixture IDs. Invalid JSON, unreadable files, and invalid fixtures cause a nonzero CLI exit.
3. `parseWorkflow` in `src/workflow.ts` parses YAML with duplicate-key checking, identifies the pull request trigger, and returns a validated, typed configuration or a conservative `unknown`/`skip` result. Unsupported aliases and malformed triggers return `unknown`.
4. `analyzeWorkflow` in `src/analyzer.ts` rejects unsupported platforms with `unknown`, then checks supported activity types, branch filters, and path filters. `src/patterns.ts` uses picomatch with an intentionally limited syntax; ordered negative and positive patterns can exclude and re-include a path or branch.
5. The CLI prints JSON containing the requested and supported platforms, before/after decisions and reasons, and a change classification. If either decision is `unknown`, the change is `unknown`.

The analyzer does not calculate diffs. Callers supply the PR's base branch, activity, changed paths, and whether the file list is complete. A branch or activity mismatch can establish `skip` before path evaluation; when path filters matter, an incomplete list or more than 3,000 supplied files produces `unknown`. At or below that boundary, results assume the supplied complete list is the relevant GitHub.com PR diff. Other platforms, including GitHub Enterprise Server, are unsupported.

## Repository map

| Path | Responsibility |
| --- | --- |
| `src/analyzer.ts` | Filter evaluation, decisions and reasons. |
| `src/fixtures.ts` | Validates fixture records and provides field-specific input errors. |
| `src/workflow.ts` | Parses workflow YAML and validates the supported trigger configuration. |
| `src/patterns.ts` | Validates the supported glob subset and matches ordered patterns. |
| `src/cli.ts` | Command-line options, file reads, comparisons and JSON output. |
| `fixtures/` | Small example workflows and PR fixtures for the README quick start. |
| `test/` | Unit, boundary, public-workflow fixture and CLI tests. |
| `validation/` | Pinned public workflow files, synthetic expectations and validation report. |
| `install.sh` | Builds and installs the CLI to a user-local npm prefix. |
| `package.json` | Declares the CLI entry point, dependencies, commands, and supported Node.js engine range. |
| `.github/workflows/quality.yml` | Runs typecheck, build, tests, a packaged CLI smoke check on supported Node.js minimums, and a weekly dependency audit. |
| `README.md` | Installation, usage, supported behavior and user-facing limitations. |

## Development and verification

```sh
npm ci
npm run build
npm run typecheck
npm test
```

For a manual check, run the sample command in the [README](../README.md#quick-start). `test/cli.test.ts` also checks that the CLI does not modify its inputs or run a workflow command, and that invalid fixture fields produce actionable errors. CI runs typecheck, build, and tests on the supported Node.js minimums, installs the packed CLI into a temporary prefix and runs the documented example, and audits locked dependencies weekly. The [validation report](../validation/README.md) describes the synthetic oracle, supported and unsupported cases, and the GitHub.com/GitHub Enterprise Server diff-limit distinction. Its scenarios are not observed GitHub runs.

When changing trigger behavior, check the [official GitHub Actions workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax) and add focused tests. Preserve conservative `unknown` results when behavior cannot be established. Document source assumptions and any discrepancy; do not describe synthetic tests as proof of GitHub-equivalent behavior.

## Keeping documentation current

Update documentation in the same change as the behavior it describes:

- **CLI, installation, fixture shape or supported filters:** update the README examples, options, and limitations.
- **Evaluation, modules or data flow:** update this architecture guide.
- **Test cases, GitHub semantics or validation claims:** update the [validation report](../validation/README.md), including the evidence source and any mismatches.
- **New or changed commands:** run the documented commands and update their expected output when needed.

Keep the documentation concise and explicit about uncertainty. A documentation update should not require copying an entire implementation or creating a new file for every change.
