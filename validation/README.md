# Validation

## v0.1 offline analyzer

These are offline, synthetic PR inputs against five **real, unmodified workflow files**. They are not historical PRs or observed GitHub runs. Manual expectations were written from each pinned workflow's `pull_request` trigger and GitHub's documented filter rules, before running the test suite. The result `run` means filter eligibility only. Repository policy, merge conflicts, workflow availability, diff timeouts, and actual execution are outside the oracle.

## Sources

- [actions/checkout test.yml](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/.github/workflows/test.yml)
- [actions/checkout check-dist.yml](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/.github/workflows/check-dist.yml)
- [actions/setup-node basic-validation.yml](https://github.com/actions/setup-node/blob/436c65619b12c9e37ff20a4700145cc387898a7d/.github/workflows/basic-validation.yml)
- [cli/cli go.yml](https://github.com/cli/cli/blob/4e71d58d4f567282a1ec2dfe4a60a17eead59308/.github/workflows/go.yml)
- [expressjs/express ci.yml](https://github.com/expressjs/express/blob/43fca52d28a422c8be48fd489cbd4f2d6152bab6/.github/workflows/ci.yml)

These workflow snapshots are third-party validation inputs, not caver-ci code. They retain their upstream rights and are excluded from the scope of the caver-ci MIT License. The links identify each source repository and pinned commit.

`real-cases.json` holds the manually specified oracle. For each workflow: an opened PR changing source is eligible; an opened PR changing README is eligible unless `paths-ignore: ['**.md']` applies; a labeled event is skipped by default; an incomplete file list is uncertain only where path filtering matters. All use base branch `main` as a synthetic input; these PR triggers do not filter branches. Upstream push branch filters are irrelevant to a `pull_request` event. `independent-cases.json` covers negative ordering, re-inclusion, branch mismatch, and incomplete files. `test/validation.test.ts` executes these fixtures and the 300/301 and 3000/3001 boundaries using an explicit GitHub.com target.

The unit suite also covers ordered branch-filter exclusions/re-inclusions, unsupported path forms including pipe alternation, and field-specific fixture validation. CI runs typecheck, build, lint, and all tests on the supported Node.js minimums, smoke-tests the packed CLI in a temporary install prefix, and audits locked dependencies weekly. These checks verify the local implementation and package; they do not establish equivalence with observed GitHub runs.

## Results

| Workflow | Source | README | Labeled | Incomplete files |
| --- | --- | --- | --- | --- |
| checkout test | run / run | run / run | skip / skip | run / run |
| checkout check-dist | run / unknown | skip / unknown | skip / unknown | unknown / unknown |
| setup-node basic-validation | run / unknown | skip / unknown | skip / unknown | unknown / unknown |
| cli go | run / run | run / run | skip / skip | run / run |
| express ci | run / run | run / run | skip / skip | run / run |

Each cell is **manual expectation / caver-ci result**. For these 20 real-workflow scenarios: 12 definite predictions, 12 correct and 0 incorrect (100% conditional accuracy on this small, selected sample); 6 unsupported definite-oracle cases abstained; and 2 cases with incomplete data warranted `unknown` and returned `unknown`. In those two cases the reported reason was the unsupported glob, so the tool did not independently establish incomplete-file uncertainty. These two groups are excluded from the accuracy denominator. The six abstentions are not counted as correct predictions. The tool returns `unknown` even for the labeled case because it validates the unsupported path pattern before checking the activity type. No definite prediction differed from the manual oracle in this set.

## Platform scope and boundary cases

v0.1 now requires an explicit target and supports **GitHub.com only**. Unsupported targets, including GitHub Enterprise Server, return `unknown` before evaluating the workflow. The JSON output reports the requested target and the supported target. A caller who incorrectly declares an Enterprise workflow as GitHub.com can still receive an inapplicable result; the tool does not inspect a server or verify the declaration.

The earlier v0.1 result was an incorrect definite `run` on [GitHub Enterprise Server 3.19](https://docs.github.com/en/enterprise-server%403.19/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons): a matching file appeared after 300 nonmatching files, outside the documented window. The regression now requests `ghes-3.19` and expects `unknown`, rather than treating a GitHub.com prediction as an Enterprise prediction. Enterprise behavior is not modeled or tested as a supported platform.

[GitHub.com documents a 3,000-file limit](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons). Complete synthetic lists of 300, 301, and 3,000 files are evaluated as whole sets; tests place a match at either end and also test no match. For 3,001 files, tests put the match at positions 1, 3,000, and 3,001, and use no match: all return `unknown`, because the fixture order is not evidence of GitHub's evaluated order. Incomplete lists return `unknown` when path filters matter. The same limit is covered for `paths-ignore`. These tests assume the supplied complete list is the relevant PR diff; they do not observe GitHub or simulate diff timeouts.

The five independent filter cases produce four correct definite decisions and one expected `unknown`. A missing required PR branch and action is rejected as invalid input rather than assigned a decision. The 20 public-workflow scenarios remain as reported above. No supported synthetic case has an incorrect definite decision in this suite; this is a statement about these fixtures, not proof of accuracy against live GitHub runs.

## v0.2 mocked GitHub REST adapter

`test/github.test.ts` uses a mocked Fetch transport. It covers PR-list and changed-file pagination, API-order preservation, list truncation metadata, empty repositories, missing branch/file/PR metadata, partial file pages, exactly and beyond the 3,000-record API boundary, rename and deletion paths, 401/403 responses, rate limits, bounded transient retries, timeouts, optional authorization headers, and GET-only behavior. These tests verify client behavior against controlled responses. They are not live GitHub results and do not establish historical workflow behavior.

The GitHub mode uses `pull_request: opened` as a labeled hypothetical event because REST pull request resources do not identify historical event actions. It applies the workflow files supplied at analysis time to historical PR file changes; it cannot recover historical workflow YAML or actual executions. See [GitHub REST mode](../docs/github-api.md) for the request bounds, token handling, API limits, and output metadata.

## v0.3 CLI and reporting regression coverage

The CLI tests cover text output for empty and mixed fixture samples, including all four summary categories and concise PR reasons. Existing assertions verify that JSON remains the default and that fixture-mode JSON retains its key shape. API adapter tests verify both paths of rename handling, deleted paths, a partial changed-file page, and a later PR-list page failure that preserves prior records while marking the sample incomplete. All these cases use synthetic inputs or mocked API responses; they do not establish observed workflow execution or savings.

Linting is provided by ESLint via `npm run lint`. v0.3 verification completed with `npm ci` (180 packages added; 181 audited; zero reported vulnerabilities), `npm run build`, `npm run typecheck`, `npm run lint`, `npm test` (4 files and 107 tests passed), and `git diff --check` all successful. npm emitted a deprecation warning for ESLint 9.39.5. A read-only smoke run of the README fixture command in text mode returned four sample rows: one newly skipped, one newly triggered, one unchanged, and one unknown. This smoke run evaluated local fixtures only; the synthetic and mocked behavior above remains distinct from live GitHub observations.

## v0.3.0 installability alpha

`npm pack --dry-run --json` completed through the `prepack` build and listed nine files (14,555-byte tarball, 48,423 bytes unpacked): `LICENSE`, `README.md`, `package.json`, and six compiled files under `dist/`. It did not include tests, fixtures, docs, lockfiles, credentials, or the pre-existing untracked directories. The resulting tarball installed into a fresh project under `/tmp`; its `node_modules/.bin/caver-ci` link was executable, `--help` worked, fixture text output matched the four-case sample, and default JSON parsed successfully. Input fixture hashes were identical before and after the local CLI run.

The compiled package was also run without `GITHUB_TOKEN` against the public `actions/checkout` repository with `--limit 1`. GitHub returned PR #2611; the tool fetched its current metadata and file list and reported `run → run` (unchanged) for the supplied workflows, with more PRs available. This is a single read-only smoke observation of the API and current inputs. It is not evidence that the workflows ran or that CI was saved. Authentication handling was tested with a dummy token in mocked CLI tests; no real token was required or used.

The lockfile license inventory has 212 package entries with declared license metadata. The production dependency tree contains 19 MIT, one Apache-2.0, and two ISC package entries. All other license entries are development-only, including 12 MPL-2.0 entries (Lightning CSS and optional platform packages), two BlueOak-1.0.0 packages, one 0BSD package, and one Python-2.0 package. This metadata inventory is a maintenance check, not a legal opinion. The project MIT license covers original caver-ci code and documentation; the linked upstream workflow snapshots keep their original rights.

## v0.3.0-alpha.0 GitHub release candidate

The candidate is versioned `0.3.0-alpha.0`; `package.json` remains private so this GitHub test release cannot be published to npm by accident. `npm ci` added 180 packages and audited 181 with no reported vulnerabilities. Build, typecheck, lint, and all 107 tests passed on Node 26.9.0; ESLint 9.39.5 emitted a deprecation warning. `git diff --check` passed. The test run required subprocess permission because the sandbox denied Node spawning with `EPERM` on its first attempt.

`npm pack --dry-run --json` produced a nine-file release asset candidate: `LICENSE`, `README.md`, `package.json`, and six compiled modules under `dist/` (12,803 bytes packed; 43,038 bytes unpacked). Installing the tarball, with `private: true` retained, in a fresh temporary project added 23 packages, audited 24 with no vulnerabilities, and verified the executable bin, alpha version, help output, fixture text mode, and parseable JSON. A global-prefix install of the tarball also passed. The CLI shebang is `#!/usr/bin/env node`. This prepares a GitHub release asset; npm publication is not part of the release.
