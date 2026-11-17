# GitHub REST mode

Repository mode evaluates the two workflow YAML files supplied to the current invocation against the current REST representation of recent pull requests and their changed files. This is a **hypothetical analysis**. It does not retrieve workflow versions, event delivery payloads, or workflow runs from the time each PR occurred.

## Access and scope

- Supported target: GitHub.com public repositories only. GitHub Enterprise Server and other forges are not supported.
- Endpoints: read repository visibility, list repository pull requests, and list files for a pull request. caver-ci refuses repositories whose metadata does not confirm public visibility. All requests use `GET`; caver-ci does not create, update, close, or comment on GitHub resources.
- Authentication is optional. Without a token, the public REST API's unauthenticated rate limit applies. Set `GITHUB_TOKEN` in the process environment to authenticate. Use a token that can read public repository metadata and pull requests; never pass it as a CLI argument.
- Token values, authorization headers, raw API error bodies, and Octokit diagnostics are not written to CLI output or JSON.
- Every request has an independent 10-second abort timeout. Transient transport, timeout, server, and eligible rate-limit failures get at most two retries after the initial attempt. Rate-limit retry waits are bounded to five seconds; larger server-requested waits fail with a sanitized message.

## Selection and pagination

The repository is provided as `owner/repository`. The PR list uses GitHub's `updated` descending order and follows its pagination links until the requested 1–100 result limit is reached or the API has no next page. The default limit is 50. The output preserves returned API order and includes `pullRequestListComplete` and `pullRequestListHasMore`; a limited list is not described as the repository's full history. If a later PR-list page fails after earlier pages succeeded, the collected records are retained and the list is marked incomplete with a sanitized reason. A failure before any PR records are returned remains a CLI error.

Changed-file requests use 100 records per page and follow all pages below the API ceiling. GitHub documents a maximum of 3,000 files for the pull request files endpoint. caver-ci marks a list incomplete as soon as it reaches 3,000, including when exactly 3,000 records were returned and no next link is visible. It stops there, because the endpoint cannot prove that no additional changed files exist. Path-filter results become `unknown` when that incompleteness could affect the decision.

## Metadata and interpretation

The API provides current PR metadata such as number, base branch, state, draft/merged status, and timestamps. Missing base-branch metadata is preserved as `null`; a branch-filter decision that needs it is `unknown`. Invalid or unnumbered PR list entries are omitted and make the overall list incomplete.

The PR resource does not say which historical `pull_request` activity action fired. Repository mode therefore sets the analysis input to the explicit hypothetical action `opened` and includes that assumption in the JSON output. It does not infer whether the PR was actually opened, synchronized, reopened, edited, or closed at the time a workflow might have run.

File records retain API status. A renamed file contributes both `filename` and `previous_filename` because either path may matter to a path filter. A removed file contributes its deleted path. Missing filenames, missing rename targets, unknown statuses, failed pages, and the 3,000-file boundary mark the file list incomplete. Partial paths may still be returned for diagnosis, but do not make a path-filter decision definite.

An empty PR list is a valid empty result. `pullRequestListComplete` describes whether the requested list was fully collected, not whether there are any PRs beyond a deliberately applied limit. `filesComplete` describes each individual PR file list.

## Output formats

JSON is the default and keeps the existing mode-specific JSON shapes. `--format text` prints the evaluated repository (or says that offline fixtures did not specify one), platform, sample size, counts of newly skipped, newly triggered, unchanged, and unknown comparisons, and one row per PR with its identifier, decisions, and concise reason. Unknown counts include a comparison if either side is unknown. This report summarizes filter evaluation for supplied inputs; it is not a record of observed workflow execution and does not guarantee CI savings.

## References

- [List pull requests](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests)
- [List pull request files](https://docs.github.com/en/rest/pulls/pulls#list-pull-requests-files)
- [GitHub REST API pagination](https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api)
- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
