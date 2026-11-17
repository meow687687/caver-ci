# v0.1 validation

These are offline, synthetic PR inputs against five **real, unmodified workflow files**. They are not historical PRs or observed GitHub runs. Manual expectations were written from each pinned workflow's `pull_request` trigger and GitHub's documented filter rules, before running the test suite. The result `run` means filter eligibility only. Repository policy, merge conflicts, workflow availability, diff timeouts, and actual execution are outside the oracle.

## Sources

- [actions/checkout test.yml](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/.github/workflows/test.yml)
- [actions/checkout check-dist.yml](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/.github/workflows/check-dist.yml)
- [actions/setup-node basic-validation.yml](https://github.com/actions/setup-node/blob/436c65619b12c9e37ff20a4700145cc387898a7d/.github/workflows/basic-validation.yml)
- [cli/cli go.yml](https://github.com/cli/cli/blob/4e71d58d4f567282a1ec2dfe4a60a17eead59308/.github/workflows/go.yml)
- [expressjs/express ci.yml](https://github.com/expressjs/express/blob/43fca52d28a422c8be48fd489cbd4f2d6152bab6/.github/workflows/ci.yml)

`real-cases.json` holds the manually specified oracle. For each workflow: an opened PR changing source is eligible; an opened PR changing README is eligible unless `paths-ignore: ['**.md']` applies; a labeled event is skipped by default; an incomplete file list is uncertain only where path filtering matters. All use base branch `main` as a synthetic input; these PR triggers do not filter branches. Upstream push branch filters are irrelevant to a `pull_request` event. `independent-cases.json` covers negative ordering, re-inclusion, branch mismatch, and incomplete files. `test/validation.test.ts` executes these fixtures and the 300/301 and 3000/3001 boundaries using an explicit GitHub.com target.

The unit suite also covers ordered branch-filter exclusions/re-inclusions, unsupported path forms, and field-specific fixture validation. CI runs typecheck, build, and all tests on the supported Node.js minimums, smoke-tests the packed CLI in a temporary install prefix, and audits locked dependencies weekly. These checks verify the local implementation and package; they do not establish equivalence with observed GitHub runs.

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
