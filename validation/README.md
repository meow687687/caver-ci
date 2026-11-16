# v0.1 validation

These are offline, synthetic PR inputs against five **real, unmodified workflow files**. They are not historical PRs or observed GitHub runs. Manual expectations were written from each pinned workflow's `pull_request` trigger and GitHub's documented filter rules, before running the test suite. The result `run` means filter eligibility only. Repository policy, merge conflicts, workflow availability, diff timeouts, and actual execution are outside the oracle.

## Sources

- [actions/checkout test.yml](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/.github/workflows/test.yml)
- [actions/checkout check-dist.yml](https://github.com/actions/checkout/blob/f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a/.github/workflows/check-dist.yml)
- [actions/setup-node basic-validation.yml](https://github.com/actions/setup-node/blob/436c65619b12c9e37ff20a4700145cc387898a7d/.github/workflows/basic-validation.yml)
- [cli/cli go.yml](https://github.com/cli/cli/blob/4e71d58d4f567282a1ec2dfe4a60a17eead59308/.github/workflows/go.yml)
- [expressjs/express ci.yml](https://github.com/expressjs/express/blob/43fca52d28a422c8be48fd489cbd4f2d6152bab6/.github/workflows/ci.yml)

`real-cases.json` holds the manually specified oracle. For each workflow: an opened PR changing source is eligible; an opened PR changing README is eligible unless `paths-ignore: ['**.md']` applies; a labeled event is skipped by default; an incomplete file list is uncertain only where path filtering matters. All use base branch `main` as a synthetic input; these PR triggers do not filter branches. Upstream push branch filters are irrelevant to a `pull_request` event. `independent-cases.json` covers negative ordering, re-inclusion, branch mismatch, and incomplete files. `test/validation.test.ts` executes these fixtures and the 300-file boundary.

## Results

| Workflow | Source | README | Labeled | Incomplete files |
| --- | --- | --- | --- | --- |
| checkout test | run / run | run / run | skip / skip | run / run |
| checkout check-dist | run / unknown | skip / unknown | skip / unknown | unknown / unknown |
| setup-node basic-validation | run / unknown | skip / unknown | skip / unknown | unknown / unknown |
| cli go | run / run | run / run | skip / skip | run / run |
| express ci | run / run | run / run | skip / skip | run / run |

Each cell is **manual expectation / caver-ci result**. For these 20 real-workflow scenarios: 12 definite predictions, 12 correct and 0 incorrect (100% conditional accuracy on this small, selected sample); 6 unsupported definite-oracle cases abstained; and 2 cases with incomplete data warranted `unknown` and returned `unknown`. In those two cases the reported reason was the unsupported glob, so the tool did not independently establish incomplete-file uncertainty. These two groups are excluded from the accuracy denominator. The six abstentions are not counted as correct predictions. The tool returns `unknown` even for the labeled case because it validates the unsupported path pattern before checking the activity type. No definite prediction differed from the manual oracle in this set.

## 300-file discrepancy and independent cases

[GitHub Enterprise Server 3.19](https://docs.github.com/en/enterprise-server%403.19/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons) documents evaluation of the first 300 files. The independent test supplies an explicitly ordered Enterprise comparison: 300 nonmatching docs followed by a matching source file. Manual Enterprise expectation: **skip**; v0.1 prediction: **run**. This is **one incorrect definite decision** for the Enterprise scenario. The analyzer has no platform or GitHub diff-order input, and treats a 301-file complete list as a single set. It should not be used to predict that Enterprise behavior. A match within the first 300 predicts run, and 300 nonmatches predict skip. The regression test records the existing discrepancy; its passing status does not mean the discrepancy is fixed.

[GitHub.com currently documents a 3,000-file limit](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons). Under the supplied complete-file-set assumption, the 301-file source match is eligible under that documented limit; this is not evidence of actual GitHub ordering or execution. The existing analyzer returns `unknown` when given more than 3,000 files and path filters. Version and deployment matter: no assumption is made that every GitHub installation uses the same limit.

The five independent filter cases produce four correct definite decisions and one expected `unknown`. A missing required PR branch and action is rejected as invalid input rather than assigned a decision. Besides the Enterprise discrepancy above, no mismatches were observed in these independent fixtures. These counts are separate from the 20 public-workflow scenarios and do not constitute an accuracy estimate across real PRs.
